const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const IB = require('../models/IB');
const IBReferral = require('../models/IBReferral');
const IBCommissionLog = require('../models/IBCommissionLog');
const IBWithdrawal = require('../models/IBWithdrawal');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// =============== IB PROFILE ===============

// @route   GET /api/ib/profile
// @desc    Get user's IB profile (auto-create if not exists)
// @access  Private
router.get('/profile', async (req, res) => {
  try {
    let ib = await IB.findOne({ userId: req.user._id });
    
    // Auto-create IB profile for user
    if (!ib) {
      ib = await IB.create({
        userId: req.user._id,
        status: 'active',
        activatedAt: new Date()
      });
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    res.json({
      success: true,
      data: {
        ...ib.toObject(),
        referralLink: ib.getReferralLink(baseUrl)
      }
    });
  } catch (error) {
    console.error('Get IB profile error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/ib/stats
// @desc    Get IB dashboard stats
// @access  Private
router.get('/stats', async (req, res) => {
  try {
    const ib = await IB.findOne({ userId: req.user._id });
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB profile not found' });
    }

    // Get additional stats
    const [totalCommissions, pendingWithdrawals] = await Promise.all([
      IBCommissionLog.aggregate([
        { $match: { ibId: ib._id, status: 'credited' } },
        { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
      ]),
      IBWithdrawal.aggregate([
        { $match: { ibId: ib._id, status: 'pending' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        totalReferrals: ib.stats.totalReferrals,
        activeReferrals: ib.stats.activeReferrals,
        totalDeposits: ib.stats.totalDeposits,
        totalTradingVolume: ib.stats.totalTradingVolume,
        totalCommissionEarned: ib.wallet.totalEarned,
        availableBalance: ib.wallet.balance,
        pendingWithdrawals: pendingWithdrawals[0]?.total || 0,
        totalWithdrawn: ib.wallet.totalWithdrawn
      }
    });
  } catch (error) {
    console.error('Get IB stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== REFERRALS ===============

// @route   GET /api/ib/referrals
// @desc    Get list of referred users
// @access  Private
router.get('/referrals', async (req, res) => {
  try {
    const ib = await IB.findOne({ userId: req.user._id });
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB profile not found' });
    }

    const { status, limit = 50, page = 1 } = req.query;
    const query = { ibId: ib._id };
    if (status) query.status = status;

    const referrals = await IBReferral.find(query)
      .populate('referredUserId', 'firstName lastName email createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await IBReferral.countDocuments(query);

    res.json({
      success: true,
      data: referrals,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get referrals error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== COMMISSION HISTORY ===============

// @route   GET /api/ib/commissions
// @desc    Get commission history
// @access  Private
router.get('/commissions', async (req, res) => {
  try {
    const ib = await IB.findOne({ userId: req.user._id });
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB profile not found' });
    }

    const { type, limit = 50, page = 1 } = req.query;
    const query = { ibId: ib._id };
    if (type) query.sourceType = type;

    const commissions = await IBCommissionLog.find(query)
      .populate('sourceUserId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await IBCommissionLog.countDocuments(query);

    // Get totals by type
    const totals = await IBCommissionLog.aggregate([
      { $match: { ibId: ib._id, status: 'credited' } },
      { $group: { _id: '$sourceType', total: { $sum: '$commissionAmount' } } }
    ]);

    res.json({
      success: true,
      data: commissions,
      totals: totals.reduce((acc, t) => ({ ...acc, [t._id]: t.total }), {}),
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get commissions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== WITHDRAWALS ===============

// @route   GET /api/ib/withdrawals
// @desc    Get withdrawal history
// @access  Private
router.get('/withdrawals', async (req, res) => {
  try {
    const ib = await IB.findOne({ userId: req.user._id });
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB profile not found' });
    }

    const withdrawals = await IBWithdrawal.find({ ibId: ib._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, data: withdrawals });
  } catch (error) {
    console.error('Get withdrawals error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/ib/withdraw
// @desc    Request commission withdrawal
// @access  Private
router.post('/withdraw', [
  body('amount').isFloat({ min: 1 }),
  body('method').isIn(['wallet', 'bank', 'upi'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const ib = await IB.findOne({ userId: req.user._id });
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB profile not found' });
    }

    const { amount, method, bankDetails } = req.body;

    // Check minimum withdrawal
    if (amount < ib.minWithdrawal) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal is $${ib.minWithdrawal}`
      });
    }

    // Check available balance
    if (amount > ib.wallet.balance) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    // Create withdrawal request
    const withdrawal = await IBWithdrawal.create({
      ibId: ib._id,
      ibUserId: ib.userId,
      amount,
      method,
      withdrawalDetails: method !== 'wallet' ? bankDetails : {},
      status: ib.requireWithdrawalApproval ? 'pending' : 'approved'
    });

    // If no approval required and method is wallet, process immediately
    if (!ib.requireWithdrawalApproval && method === 'wallet') {
      ib.wallet.balance -= amount;
      ib.wallet.totalWithdrawn += amount;
      await ib.save();

      // Credit user's main wallet
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { balance: amount }
      });

      withdrawal.status = 'completed';
      withdrawal.processedAt = new Date();
      await withdrawal.save();
    } else {
      // Hold balance for pending withdrawal
      ib.wallet.balance -= amount;
      ib.wallet.pendingBalance += amount;
      await ib.save();
    }

    res.status(201).json({
      success: true,
      message: ib.requireWithdrawalApproval 
        ? 'Withdrawal request submitted for approval'
        : 'Withdrawal processed successfully',
      data: withdrawal
    });
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/ib/withdraw-to-wallet
// @desc    Quick withdraw to trading wallet (if no approval needed)
// @access  Private
router.post('/withdraw-to-wallet', [
  body('amount').isFloat({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const ib = await IB.findOne({ userId: req.user._id });
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB profile not found' });
    }

    const { amount } = req.body;

    if (amount < 1) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal is $1' });
    }

    if (amount > ib.wallet.balance) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    // Deduct from IB wallet
    ib.wallet.balance -= amount;
    ib.wallet.totalWithdrawn += amount;
    await ib.save();

    // Credit user's main wallet
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { balance: amount }
    });

    // Create withdrawal record
    await IBWithdrawal.create({
      ibId: ib._id,
      ibUserId: ib.userId,
      amount,
      method: 'wallet',
      status: 'completed',
      processedAt: new Date()
    });

    res.json({
      success: true,
      message: `$${amount} transferred to your trading wallet`,
      data: { newBalance: ib.wallet.balance }
    });
  } catch (error) {
    console.error('Withdraw to wallet error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
