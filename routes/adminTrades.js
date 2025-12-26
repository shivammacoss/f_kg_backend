const express = require('express');
const router = express.Router();
const Trade = require('../models/Trade');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { protectAdmin } = require('./adminAuth');
const tradeEngine = require('../services/TradeEngine');

// @route   GET /api/admin/trades
// @desc    Get all trades
// @access  Admin
router.get('/', protectAdmin, async (req, res) => {
  try {
    const { status, type, userId, limit = 100, page = 1 } = req.query;
    const query = {};
    
    if (status && status !== 'all') query.status = status;
    if (type && type !== 'all') query.type = type;
    if (userId) query.user = userId;

    const trades = await Trade.find(query)
      .populate('user', 'firstName lastName email balance')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Trade.countDocuments(query);

    res.json({ 
      success: true, 
      data: trades,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get trades error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/trades/stats
// @desc    Get trade statistics
// @access  Admin
router.get('/stats', protectAdmin, async (req, res) => {
  try {
    const [total, open, closed, pending] = await Promise.all([
      Trade.countDocuments(),
      Trade.countDocuments({ status: 'open' }),
      Trade.countDocuments({ status: 'closed' }),
      Trade.countDocuments({ status: 'pending' })
    ]);

    const volumeResult = await Trade.aggregate([
      { $group: { _id: null, totalVolume: { $sum: '$amount' }, totalProfit: { $sum: '$profit' } } }
    ]);

    res.json({
      success: true,
      data: {
        total,
        open,
        closed,
        pending,
        totalVolume: volumeResult[0]?.totalVolume || 0,
        totalProfit: volumeResult[0]?.totalProfit || 0
      }
    });
  } catch (error) {
    console.error('Get trade stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/trades
// @desc    Create trade for a user (admin)
// @access  Admin
router.post('/', protectAdmin, async (req, res) => {
  try {
    const { userId, symbol, type, amount, leverage, stopLoss, takeProfit, price } = req.body;

    if (!userId || !symbol || !type || !amount) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Execute market order through trade engine
    const trade = await tradeEngine.executeMarketOrder(userId, {
      symbol,
      type,
      amount,
      leverage: leverage || 100,
      stopLoss: stopLoss ? parseFloat(stopLoss) : null,
      takeProfit: takeProfit ? parseFloat(takeProfit) : null
    });

    res.status(201).json({ success: true, data: trade, message: 'Trade created successfully' });
  } catch (error) {
    console.error('Create trade error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// @route   PUT /api/admin/trades/:id/modify
// @desc    Modify trade (admin - full control over all fields)
// @access  Admin
router.put('/:id/modify', protectAdmin, async (req, res) => {
  try {
    const { 
      stopLoss, takeProfit, profit, notes, closePrice,
      // Full admin control fields
      price, amount, type, symbol, createdAt, closedAt, leverage, margin, fee
    } = req.body;

    const trade = await Trade.findById(req.params.id);
    if (!trade) {
      return res.status(404).json({ success: false, message: 'Trade not found' });
    }

    // Admin full control - can modify any field on any trade
    if (stopLoss !== undefined) trade.stopLoss = stopLoss;
    if (takeProfit !== undefined) trade.takeProfit = takeProfit;
    if (notes !== undefined) trade.notes = notes;
    
    // Entry price
    if (price !== undefined) trade.price = price;
    
    // Quantity/Lots
    if (amount !== undefined) trade.amount = amount;
    
    // Side (buy/sell)
    if (type !== undefined && (type === 'buy' || type === 'sell')) trade.type = type;
    
    // Symbol
    if (symbol !== undefined) trade.symbol = symbol;
    
    // Leverage
    if (leverage !== undefined) trade.leverage = leverage;
    
    // Margin
    if (margin !== undefined) trade.margin = margin;
    
    // Fee
    if (fee !== undefined) trade.fee = fee;
    
    // Time (createdAt)
    if (createdAt !== undefined) trade.createdAt = new Date(createdAt);
    
    // Close time
    if (closedAt !== undefined) trade.closedAt = new Date(closedAt);
    
    // Close price
    if (closePrice !== undefined) trade.closePrice = closePrice;
    
    // Profit - update user balance if changed
    if (profit !== undefined) {
      const profitDiff = profit - (trade.profit || 0);
      trade.profit = profit;
      
      if (profitDiff !== 0) {
        const user = await User.findById(trade.user);
        if (user) {
          user.balance += profitDiff;
          await user.save();
        }
      }
    }

    await trade.save();

    res.json({ success: true, data: trade, message: 'Trade modified successfully' });
  } catch (error) {
    console.error('Modify trade error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/trades/:id/close
// @desc    Close trade (admin)
// @access  Admin
router.put('/:id/close', protectAdmin, async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.id).populate('user');
    if (!trade) {
      return res.status(404).json({ success: false, message: 'Trade not found' });
    }

    if (trade.status === 'closed') {
      return res.status(400).json({ success: false, message: 'Trade already closed' });
    }

    // If pending, just cancel it
    if (trade.status === 'pending') {
      trade.status = 'cancelled';
      trade.closedAt = new Date();
      trade.closeReason = 'admin_cancelled';
      await trade.save();

      // Release margin
      const user = await User.findById(trade.user._id || trade.user);
      if (user && trade.margin) {
        user.balance += trade.margin;
        await user.save();
      }

      return res.json({ success: true, data: trade, message: 'Order cancelled' });
    }

    // Close open trade
    const closedTrade = await tradeEngine.closeTrade(trade._id, 'admin_closed');

    res.json({ success: true, data: closedTrade, message: 'Trade closed successfully' });
  } catch (error) {
    console.error('Close trade error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// @route   DELETE /api/admin/trades/:id
// @desc    Delete trade (admin only, use with caution)
// @access  Admin
router.delete('/:id', protectAdmin, async (req, res) => {
  try {
    const trade = await Trade.findById(req.params.id);
    if (!trade) {
      return res.status(404).json({ success: false, message: 'Trade not found' });
    }

    // Only allow deleting closed/cancelled trades
    if (trade.status === 'open' || trade.status === 'pending') {
      return res.status(400).json({ success: false, message: 'Cannot delete active trade. Close it first.' });
    }

    await Trade.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Trade deleted' });
  } catch (error) {
    console.error('Delete trade error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
