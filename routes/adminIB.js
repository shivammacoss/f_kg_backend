const express = require('express');
const router = express.Router();
const IB = require('../models/IB');
const IBReferral = require('../models/IBReferral');
const IBCommissionLog = require('../models/IBCommissionLog');
const IBWithdrawal = require('../models/IBWithdrawal');
const User = require('../models/User');
const { protectAdmin } = require('./adminAuth');

// All routes require admin authentication
router.use(protectAdmin);

// =============== STATS ===============

// @route   GET /api/admin/ib/stats
// @desc    Get IB system statistics
// @access  Admin
router.get('/stats', async (req, res) => {
  try {
    const [
      totalIBs,
      activeIBs,
      totalReferrals,
      totalCommissions,
      pendingWithdrawals
    ] = await Promise.all([
      IB.countDocuments(),
      IB.countDocuments({ status: 'active' }),
      IBReferral.countDocuments(),
      IBCommissionLog.aggregate([
        { $match: { status: 'credited' } },
        { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
      ]),
      IBWithdrawal.countDocuments({ status: 'pending' })
    ]);

    res.json({
      success: true,
      data: {
        totalIBs,
        activeIBs,
        totalReferrals,
        totalCommissions: totalCommissions[0]?.total || 0,
        pendingWithdrawals
      }
    });
  } catch (error) {
    console.error('Get IB stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== IB MANAGEMENT ===============

// @route   GET /api/admin/ib/list
// @desc    Get all IBs
// @access  Admin
router.get('/list', async (req, res) => {
  try {
    const { status, search, limit = 50 } = req.query;
    
    const query = {};
    if (status && status !== 'all') query.status = status;

    let ibs = await IB.find(query)
      .populate('userId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Filter by search if provided
    if (search) {
      const searchLower = search.toLowerCase();
      ibs = ibs.filter(ib => 
        ib.ibId?.toLowerCase().includes(searchLower) ||
        ib.userId?.firstName?.toLowerCase().includes(searchLower) ||
        ib.userId?.lastName?.toLowerCase().includes(searchLower) ||
        ib.userId?.email?.toLowerCase().includes(searchLower)
      );
    }

    res.json({ success: true, data: ibs });
  } catch (error) {
    console.error('Get IBs error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/ib/:id
// @desc    Get single IB details
// @access  Admin
router.get('/:id', async (req, res) => {
  try {
    const ib = await IB.findById(req.params.id)
      .populate('userId', 'firstName lastName email balance');

    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB not found' });
    }

    const [referrals, recentCommissions, pendingWithdrawals] = await Promise.all([
      IBReferral.find({ ibId: ib._id })
        .populate('referredUserId', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .limit(20),
      IBCommissionLog.find({ ibId: ib._id })
        .populate('sourceUserId', 'firstName lastName')
        .sort({ createdAt: -1 })
        .limit(20),
      IBWithdrawal.find({ ibId: ib._id, status: 'pending' })
    ]);

    res.json({
      success: true,
      data: {
        ib,
        referrals,
        recentCommissions,
        pendingWithdrawals
      }
    });
  } catch (error) {
    console.error('Get IB details error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/ib/:id
// @desc    Update IB settings
// @access  Admin
router.put('/:id', async (req, res) => {
  try {
    const ib = await IB.findById(req.params.id);
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB not found' });
    }

    const {
      status,
      commissionType,
      commissionValue,
      firstDepositCommission,
      minWithdrawal,
      requireWithdrawalApproval,
      commissionFrozen,
      adminNote
    } = req.body;

    if (status) ib.status = status;
    if (commissionType) ib.commissionType = commissionType;
    if (commissionValue !== undefined) ib.commissionValue = commissionValue;
    if (firstDepositCommission) {
      ib.firstDepositCommission = {
        ...ib.firstDepositCommission,
        ...firstDepositCommission
      };
    }
    if (minWithdrawal !== undefined) ib.minWithdrawal = minWithdrawal;
    if (requireWithdrawalApproval !== undefined) ib.requireWithdrawalApproval = requireWithdrawalApproval;
    if (commissionFrozen !== undefined) ib.commissionFrozen = commissionFrozen;
    if (adminNote !== undefined) ib.adminNote = adminNote;

    await ib.save();

    res.json({ success: true, message: 'IB updated', data: ib });
  } catch (error) {
    console.error('Update IB error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/ib/:id/suspend
// @desc    Suspend/Activate IB
// @access  Admin
router.put('/:id/suspend', async (req, res) => {
  try {
    const ib = await IB.findById(req.params.id);
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB not found' });
    }

    ib.status = ib.status === 'suspended' ? 'active' : 'suspended';
    await ib.save();

    res.json({
      success: true,
      message: ib.status === 'suspended' ? 'IB suspended' : 'IB activated',
      data: ib
    });
  } catch (error) {
    console.error('Suspend IB error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/ib/:id/adjust-wallet
// @desc    Manually adjust IB wallet
// @access  Admin
router.post('/:id/adjust-wallet', async (req, res) => {
  try {
    const ib = await IB.findById(req.params.id);
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB not found' });
    }

    const { amount, reason } = req.body;

    if (!amount || isNaN(amount)) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // Create commission log for adjustment
    await IBCommissionLog.create({
      ibId: ib._id,
      ibUserId: ib.userId,
      sourceUserId: ib.userId,
      sourceType: 'manual_adjustment',
      commissionType: 'manual',
      commissionRate: 0,
      commissionAmount: amount,
      status: 'credited',
      description: reason || 'Manual adjustment by admin',
      isManualAdjustment: true,
      adjustedBy: req.admin._id
    });

    // Update wallet
    ib.wallet.balance += amount;
    if (amount > 0) {
      ib.wallet.totalEarned += amount;
    }
    await ib.save();

    res.json({
      success: true,
      message: `Wallet adjusted by $${amount}`,
      data: { newBalance: ib.wallet.balance }
    });
  } catch (error) {
    console.error('Adjust wallet error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== REFERRALS ===============

// @route   GET /api/admin/ib/referrals/all
// @desc    Get all referrals
// @access  Admin
router.get('/referrals/all', async (req, res) => {
  try {
    const { ibId, limit = 100 } = req.query;
    
    const query = {};
    if (ibId) query.ibId = ibId;

    const referrals = await IBReferral.find(query)
      .populate('ibId', 'ibId')
      .populate('ibUserId', 'firstName lastName')
      .populate('referredUserId', 'firstName lastName email balance')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({ success: true, data: referrals });
  } catch (error) {
    console.error('Get all referrals error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== COMMISSIONS ===============

// @route   GET /api/admin/ib/commissions/all
// @desc    Get all commission logs
// @access  Admin
router.get('/commissions/all', async (req, res) => {
  try {
    const { ibId, type, limit = 100 } = req.query;
    
    const query = {};
    if (ibId) query.ibId = ibId;
    if (type) query.sourceType = type;

    const commissions = await IBCommissionLog.find(query)
      .populate('ibId', 'ibId')
      .populate('ibUserId', 'firstName lastName')
      .populate('sourceUserId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    const totalPaid = await IBCommissionLog.aggregate([
      { $match: { status: 'credited' } },
      { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
    ]);

    res.json({
      success: true,
      data: commissions,
      stats: { totalPaid: totalPaid[0]?.total || 0 }
    });
  } catch (error) {
    console.error('Get all commissions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== WITHDRAWALS ===============

// @route   GET /api/admin/ib/withdrawals
// @desc    Get all withdrawal requests
// @access  Admin
router.get('/withdrawals/all', async (req, res) => {
  try {
    const { status, limit = 100 } = req.query;
    
    const query = {};
    if (status && status !== 'all') query.status = status;

    const withdrawals = await IBWithdrawal.find(query)
      .populate('ibId', 'ibId')
      .populate('ibUserId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({ success: true, data: withdrawals });
  } catch (error) {
    console.error('Get withdrawals error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/ib/withdrawals/:id/approve
// @desc    Approve withdrawal request
// @access  Admin
router.put('/withdrawals/:id/approve', async (req, res) => {
  try {
    const withdrawal = await IBWithdrawal.findById(req.params.id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Withdrawal already processed' });
    }

    const ib = await IB.findById(withdrawal.ibId);
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB not found' });
    }

    // Move from pending to withdrawn
    ib.wallet.pendingBalance -= withdrawal.amount;
    ib.wallet.totalWithdrawn += withdrawal.amount;

    // If withdrawal to wallet, credit user
    if (withdrawal.method === 'wallet') {
      await User.findByIdAndUpdate(withdrawal.ibUserId, {
        $inc: { balance: withdrawal.amount }
      });
    }

    await ib.save();

    withdrawal.status = 'approved';
    withdrawal.processedAt = new Date();
    withdrawal.processedBy = req.admin._id;
    await withdrawal.save();

    res.json({ success: true, message: 'Withdrawal approved', data: withdrawal });
  } catch (error) {
    console.error('Approve withdrawal error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/ib/withdrawals/:id/reject
// @desc    Reject withdrawal request
// @access  Admin
router.put('/withdrawals/:id/reject', async (req, res) => {
  try {
    const withdrawal = await IBWithdrawal.findById(req.params.id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal not found' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Withdrawal already processed' });
    }

    const ib = await IB.findById(withdrawal.ibId);
    if (!ib) {
      return res.status(404).json({ success: false, message: 'IB not found' });
    }

    // Return funds to available balance
    ib.wallet.pendingBalance -= withdrawal.amount;
    ib.wallet.balance += withdrawal.amount;
    await ib.save();

    withdrawal.status = 'rejected';
    withdrawal.rejectionReason = req.body.reason || 'Rejected by admin';
    withdrawal.processedAt = new Date();
    withdrawal.processedBy = req.admin._id;
    await withdrawal.save();

    res.json({ success: true, message: 'Withdrawal rejected', data: withdrawal });
  } catch (error) {
    console.error('Reject withdrawal error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
