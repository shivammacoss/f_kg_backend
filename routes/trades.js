const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Trade = require('../models/Trade');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const TradeMaster = require('../models/TradeMaster');
const CopyTradeEngine = require('../services/copyTradeEngine');
const { protect } = require('../middleware/auth');
const tradeEngine = require('../services/TradeEngine');

// Initialize copy trade engine (io will be set later via tradeEngine)
let copyTradeEngine = null;

// Get or create copy trade engine instance
const getCopyTradeEngine = () => {
  if (!copyTradeEngine) {
    copyTradeEngine = new CopyTradeEngine(tradeEngine.io);
  }
  return copyTradeEngine;
};

// @route   GET /api/trades
// @desc    Get all trades for current user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { status, symbol, page = 1, limit = 20 } = req.query;
    
    const query = { user: req.user.id };
    if (status) query.status = status;
    if (symbol) query.symbol = symbol.toUpperCase();

    const trades = await Trade.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Trade.countDocuments(query);

    res.json({
      success: true,
      data: {
        trades,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get trades error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/trades/prices
// @desc    Get all current prices
// @access  Private
router.get('/prices', protect, async (req, res) => {
  try {
    const prices = tradeEngine.getAllPrices();
    res.json({ success: true, data: prices });
  } catch (error) {
    console.error('Get prices error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/trades/price/:symbol
// @desc    Get current price for symbol
// @access  Private
router.get('/price/:symbol', protect, async (req, res) => {
  try {
    const price = tradeEngine.getPrice(req.params.symbol);
    if (!price) {
      return res.status(404).json({ success: false, message: 'Symbol not found' });
    }
    res.json({ success: true, data: price });
  } catch (error) {
    console.error('Get price error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/trades/floating-pnl
// @desc    Get floating P&L for user
// @access  Private
router.get('/floating-pnl', protect, async (req, res) => {
  try {
    const result = await tradeEngine.getFloatingPnL(req.user.id);
    const user = await User.findById(req.user.id);
    
    res.json({
      success: true,
      data: {
        ...result,
        balance: user.balance,
        equity: user.balance + result.totalPnL
      }
    });
  } catch (error) {
    console.error('Get floating PnL error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/trades
// @desc    Create new trade (market or pending order)
// @access  Private
router.post('/', protect, [
  body('symbol').notEmpty().withMessage('Symbol is required'),
  body('type').isIn(['buy', 'sell']).withMessage('Type must be buy or sell'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount/Lot size must be at least 0.01')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { symbol, type, orderType = 'market', amount, price, leverage = 100, stopLoss, takeProfit } = req.body;

    let trade;
    
    if (orderType === 'market') {
      // Execute market order immediately
      trade = await tradeEngine.executeMarketOrder(req.user.id, {
        symbol,
        type,
        amount,
        leverage,
        stopLoss,
        takeProfit
      });

      // Check if user is a trade master and mirror to followers
      const user = await User.findById(req.user.id);
      console.log(`[CopyTrade] Checking if user ${req.user.id} is a trade master...`);
      
      const tradeMaster = await TradeMaster.findOne({ userId: req.user.id, status: 'approved' });
      console.log(`[CopyTrade] TradeMaster found: ${tradeMaster ? 'YES' : 'NO'}`);
      
      if (tradeMaster) {
        console.log(`[CopyTrade] User is approved master, mirroring trade ${trade._id}...`);
        // Mirror trade to followers asynchronously
        const engine = getCopyTradeEngine();
        engine.mirrorTradeToFollowers(trade, user).then(results => {
          console.log(`[CopyTrade] Mirror complete. Success: ${results.filter(r => r.success).length}, Failed: ${results.filter(r => !r.success).length}`);
          results.forEach(r => {
            if (!r.success) console.log(`[CopyTrade] Failed for follower ${r.followerId}: ${r.reason}`);
          });
        }).catch(err => {
          console.error('[CopyTrade] Mirror error:', err);
        });
      } else {
        // Check if user has any master profile
        const anyMaster = await TradeMaster.findOne({ userId: req.user.id });
        if (anyMaster) {
          console.log(`[CopyTrade] User has master profile but status is: ${anyMaster.status}`);
        }
      }
    } else {
      // Create pending order (limit/stop)
      if (!price) {
        return res.status(400).json({
          success: false,
          message: 'Price is required for pending orders'
        });
      }
      trade = await tradeEngine.executePendingOrder(req.user.id, {
        symbol,
        type,
        orderType,
        amount,
        price,
        leverage,
        stopLoss,
        takeProfit
      });
    }

    res.status(201).json({
      success: true,
      message: orderType === 'market' ? 'Trade opened successfully' : 'Pending order placed',
      data: trade
    });
  } catch (error) {
    console.error('Create trade error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create trade'
    });
  }
});

// @route   PUT /api/trades/:id/close
// @desc    Close a trade
// @access  Private
router.put('/:id/close', protect, async (req, res) => {
  try {
    const trade = await Trade.findOne({
      _id: req.params.id,
      user: req.user.id,
      status: 'open'
    });

    if (!trade) {
      return res.status(404).json({
        success: false,
        message: 'Trade not found or already closed'
      });
    }

    // Get current market price
    const price = tradeEngine.getPrice(trade.symbol);
    if (!price) {
      return res.status(400).json({
        success: false,
        message: 'Unable to get current price'
      });
    }

    const closePrice = trade.type === 'buy' ? price.bid : price.ask;
    const closedTrade = await tradeEngine.closeTrade(trade, closePrice, 'manual');
    
    // Note: TradeEngine.closeTrade already handles closing follower trades internally

    res.json({
      success: true,
      message: 'Trade closed successfully',
      data: closedTrade
    });
  } catch (error) {
    console.error('Close trade error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
});

// @route   PUT /api/trades/:id/modify
// @desc    Modify trade SL/TP
// @access  Private
router.put('/:id/modify', protect, async (req, res) => {
  try {
    const { stopLoss, takeProfit } = req.body;
    
    const trade = await tradeEngine.modifyTrade(req.params.id, req.user.id, {
      stopLoss,
      takeProfit
    });

    res.json({
      success: true,
      message: 'Trade modified successfully',
      data: trade
    });
  } catch (error) {
    console.error('Modify trade error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to modify trade'
    });
  }
});

// @route   PUT /api/trades/:id/cancel
// @desc    Cancel pending order
// @access  Private
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const trade = await tradeEngine.cancelPendingOrder(req.params.id, req.user.id);

    res.json({
      success: true,
      message: 'Pending order cancelled',
      data: trade
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to cancel order'
    });
  }
});

// @route   POST /api/trades/close-all
// @desc    Close all open trades
// @access  Private
router.post('/close-all', protect, async (req, res) => {
  try {
    const openTrades = await Trade.find({ user: req.user.id, status: 'open' });
    const closedTrades = [];
    let totalPnL = 0;

    for (const trade of openTrades) {
      const price = tradeEngine.getPrice(trade.symbol);
      if (!price) continue;

      const closePrice = trade.type === 'buy' ? price.bid : price.ask;
      const closedTrade = await tradeEngine.closeTrade(trade, closePrice, 'manual');
      if (closedTrade) {
        closedTrades.push(closedTrade);
        totalPnL += closedTrade.profit;
      }
    }

    res.json({
      success: true,
      message: `Closed ${closedTrades.length} trades`,
      data: {
        closedTrades,
        totalPnL
      }
    });
  } catch (error) {
    console.error('Close all trades error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
});

// @route   GET /api/trades/stats
// @desc    Get trading statistics
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const stats = await Trade.aggregate([
      { $match: { user: req.user._id } },
      {
        $group: {
          _id: null,
          totalTrades: { $sum: 1 },
          openTrades: {
            $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] }
          },
          closedTrades: {
            $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] }
          },
          totalProfit: {
            $sum: { $cond: [{ $eq: ['$status', 'closed'] }, '$profit', 0] }
          },
          winningTrades: {
            $sum: { $cond: [{ $and: [{ $eq: ['$status', 'closed'] }, { $gt: ['$profit', 0] }] }, 1, 0] }
          },
          losingTrades: {
            $sum: { $cond: [{ $and: [{ $eq: ['$status', 'closed'] }, { $lt: ['$profit', 0] }] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        totalTrades: 0,
        openTrades: 0,
        closedTrades: 0,
        totalProfit: 0,
        winningTrades: 0,
        losingTrades: 0
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
