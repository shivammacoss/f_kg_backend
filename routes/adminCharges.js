const express = require('express');
const router = express.Router();
const TradingCharge = require('../models/TradingCharge');
const User = require('../models/User');
const { protectAdmin } = require('./adminAuth');

// @route   GET /api/admin/charges
// @desc    Get all trading charges
// @access  Admin
router.get('/', protectAdmin, async (req, res) => {
  try {
    const { scopeType, segment, symbol } = req.query;
    const query = {};
    
    if (scopeType) query.scopeType = scopeType;
    if (segment) query.segment = segment;
    if (symbol) query.symbol = symbol.toUpperCase();

    const charges = await TradingCharge.find(query)
      .populate('userId', 'firstName lastName email')
      .populate('createdBy', 'name')
      .sort({ scopeType: 1, createdAt: -1 });

    res.json({ success: true, data: charges });
  } catch (error) {
    console.error('Get charges error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/charges/stats
// @desc    Get charges statistics
// @access  Admin
router.get('/stats', protectAdmin, async (req, res) => {
  try {
    const [global, segment, symbol, user, total] = await Promise.all([
      TradingCharge.countDocuments({ scopeType: 'global', isActive: true }),
      TradingCharge.countDocuments({ scopeType: 'segment', isActive: true }),
      TradingCharge.countDocuments({ scopeType: 'symbol', isActive: true }),
      TradingCharge.countDocuments({ scopeType: 'user', isActive: true }),
      TradingCharge.countDocuments({ isActive: true })
    ]);

    res.json({
      success: true,
      data: { global, segment, symbol, user, total }
    });
  } catch (error) {
    console.error('Get charges stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/charges
// @desc    Create new trading charge
// @access  Admin
router.post('/', protectAdmin, async (req, res) => {
  try {
    const {
      scopeType,
      segment,
      symbol,
      userId,
      spreadPips,
      commissionPerLot,
      swapLong,
      swapShort,
      feePercentage,
      minFee,
      maxFee,
      description
    } = req.body;

    // Validate based on scopeType
    if (scopeType === 'segment' && !segment) {
      return res.status(400).json({ success: false, message: 'Segment is required for segment-type charges' });
    }
    if (scopeType === 'symbol' && !symbol) {
      return res.status(400).json({ success: false, message: 'Symbol is required for symbol-type charges' });
    }
    if (scopeType === 'user' && !userId) {
      return res.status(400).json({ success: false, message: 'User is required for user-type charges' });
    }

    // Check for duplicate
    const existingQuery = { scopeType };
    if (segment) existingQuery.segment = segment;
    if (symbol) existingQuery.symbol = symbol.toUpperCase();
    if (userId) existingQuery.userId = userId;

    const existing = await TradingCharge.findOne(existingQuery);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Charge setting already exists for this scope' });
    }

    const charge = await TradingCharge.create({
      scopeType,
      segment: scopeType === 'segment' ? segment : null,
      symbol: scopeType === 'symbol' ? symbol.toUpperCase() : null,
      userId: scopeType === 'user' ? userId : null,
      spreadPips: spreadPips || 0,
      commissionPerLot: commissionPerLot || 0,
      swapLong: swapLong || 0,
      swapShort: swapShort || 0,
      feePercentage: feePercentage || 0.1,
      minFee: minFee || 0,
      maxFee: maxFee || 0,
      description,
      createdBy: req.admin._id
    });

    res.status(201).json({ success: true, data: charge });
  } catch (error) {
    console.error('Create charge error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/charges/:id
// @desc    Update trading charge
// @access  Admin
router.put('/:id', protectAdmin, async (req, res) => {
  try {
    const {
      spreadPips,
      commissionPerLot,
      swapLong,
      swapShort,
      feePercentage,
      minFee,
      maxFee,
      description,
      isActive
    } = req.body;

    const charge = await TradingCharge.findByIdAndUpdate(
      req.params.id,
      {
        spreadPips,
        commissionPerLot,
        swapLong,
        swapShort,
        feePercentage,
        minFee,
        maxFee,
        description,
        isActive
      },
      { new: true }
    );

    if (!charge) {
      return res.status(404).json({ success: false, message: 'Charge not found' });
    }

    res.json({ success: true, data: charge });
  } catch (error) {
    console.error('Update charge error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/admin/charges/:id
// @desc    Delete trading charge
// @access  Admin
router.delete('/:id', protectAdmin, async (req, res) => {
  try {
    const charge = await TradingCharge.findByIdAndDelete(req.params.id);

    if (!charge) {
      return res.status(404).json({ success: false, message: 'Charge not found' });
    }

    res.json({ success: true, message: 'Charge deleted' });
  } catch (error) {
    console.error('Delete charge error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/charges/preview/:symbol
// @desc    Preview effective charges for a symbol
// @access  Admin
router.get('/preview/:symbol', protectAdmin, async (req, res) => {
  try {
    const { userId } = req.query;
    const charges = await TradingCharge.getChargesForTrade(req.params.symbol, userId);
    res.json({ success: true, data: charges });
  } catch (error) {
    console.error('Preview charges error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/charges/symbols
// @desc    Get list of all tradable symbols
// @access  Admin
router.get('/symbols', protectAdmin, async (req, res) => {
  try {
    const symbols = [
      // Forex
      { symbol: 'EURUSD', segment: 'forex', name: 'Euro / US Dollar' },
      { symbol: 'GBPUSD', segment: 'forex', name: 'British Pound / US Dollar' },
      { symbol: 'USDJPY', segment: 'forex', name: 'US Dollar / Japanese Yen' },
      { symbol: 'USDCHF', segment: 'forex', name: 'US Dollar / Swiss Franc' },
      { symbol: 'AUDUSD', segment: 'forex', name: 'Australian Dollar / US Dollar' },
      { symbol: 'USDCAD', segment: 'forex', name: 'US Dollar / Canadian Dollar' },
      { symbol: 'NZDUSD', segment: 'forex', name: 'New Zealand Dollar / US Dollar' },
      { symbol: 'EURGBP', segment: 'forex', name: 'Euro / British Pound' },
      { symbol: 'EURJPY', segment: 'forex', name: 'Euro / Japanese Yen' },
      { symbol: 'GBPJPY', segment: 'forex', name: 'British Pound / Japanese Yen' },
      // Metals
      { symbol: 'XAUUSD', segment: 'metals', name: 'Gold / US Dollar' },
      { symbol: 'XAGUSD', segment: 'metals', name: 'Silver / US Dollar' },
      // Crypto
      { symbol: 'BTCUSD', segment: 'crypto', name: 'Bitcoin / US Dollar' },
      { symbol: 'ETHUSD', segment: 'crypto', name: 'Ethereum / US Dollar' },
      { symbol: 'XRPUSD', segment: 'crypto', name: 'Ripple / US Dollar' },
      { symbol: 'SOLUSD', segment: 'crypto', name: 'Solana / US Dollar' },
      // Indices
      { symbol: 'US30', segment: 'indices', name: 'Dow Jones 30' },
      { symbol: 'US500', segment: 'indices', name: 'S&P 500' },
      { symbol: 'NAS100', segment: 'indices', name: 'Nasdaq 100' },
    ];

    res.json({ success: true, data: symbols });
  } catch (error) {
    console.error('Get symbols error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
