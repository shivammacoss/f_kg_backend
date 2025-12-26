const express = require('express');
const router = express.Router();
const TradeMaster = require('../models/TradeMaster');
const TradeMasterRequest = require('../models/TradeMasterRequest');
const CopyFollower = require('../models/CopyFollower');
const CopyTradeMap = require('../models/CopyTradeMap');
const CommissionLog = require('../models/CommissionLog');
const User = require('../models/User');
const { protectAdmin } = require('./adminAuth');

// All routes require admin authentication
router.use(protectAdmin);

// =============== MASTER REQUESTS ===============

// @route   GET /api/admin/copy-trade/requests
// @desc    Get all trade master requests
// @access  Admin
router.get('/requests', async (req, res) => {
  try {
    const { status = 'all' } = req.query;
    
    const query = {};
    if (status !== 'all') query.status = status;

    const requests = await TradeMasterRequest.find(query)
      .populate('userId', 'firstName lastName email balance createdAt')
      .sort({ createdAt: -1 });

    const stats = {
      total: await TradeMasterRequest.countDocuments(),
      pending: await TradeMasterRequest.countDocuments({ status: 'pending' }),
      approved: await TradeMasterRequest.countDocuments({ status: 'approved' }),
      rejected: await TradeMasterRequest.countDocuments({ status: 'rejected' })
    };

    res.json({ success: true, data: requests, stats });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/copy-trade/requests/:id/approve
// @desc    Approve trade master request
// @access  Admin
router.put('/requests/:id/approve', async (req, res) => {
  try {
    const request = await TradeMasterRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Request already processed' });
    }

    const user = await User.findById(request.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { adminNote, commissionType, commissionValue } = req.body;

    // Create Trade Master profile
    const tradeMaster = await TradeMaster.create({
      userId: request.userId,
      displayName: `${user.firstName} ${user.lastName}`,
      strategyType: request.strategy,
      description: request.description,
      status: 'approved',
      commissionType: commissionType || request.preferredCommissionType,
      commissionValue: commissionValue || request.preferredCommissionValue,
      riskLevel: request.riskLevel,
      minCopyAmount: request.minCapital,
      approvedAt: new Date(),
      approvedBy: req.admin._id
    });

    // Update request
    request.status = 'approved';
    request.adminNote = adminNote || '';
    request.processedAt = new Date();
    request.processedBy = req.admin._id;
    await request.save();

    res.json({
      success: true,
      message: 'Trade master approved',
      data: { request, tradeMaster }
    });
  } catch (error) {
    console.error('Approve request error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/copy-trade/requests/:id/reject
// @desc    Reject trade master request
// @access  Admin
router.put('/requests/:id/reject', async (req, res) => {
  try {
    const request = await TradeMasterRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Request already processed' });
    }

    const { rejectionReason } = req.body;

    request.status = 'rejected';
    request.rejectionReason = rejectionReason || 'Application rejected';
    request.processedAt = new Date();
    request.processedBy = req.admin._id;
    await request.save();

    res.json({ success: true, message: 'Request rejected', data: request });
  } catch (error) {
    console.error('Reject request error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== TRADE MASTERS ===============

// @route   GET /api/admin/copy-trade/masters
// @desc    Get all trade masters
// @access  Admin
router.get('/masters', async (req, res) => {
  try {
    const { status = 'all' } = req.query;
    
    const query = {};
    if (status !== 'all') query.status = status;

    const masters = await TradeMaster.find(query)
      .populate('userId', 'firstName lastName email balance')
      .sort({ createdAt: -1 });

    const stats = {
      total: await TradeMaster.countDocuments(),
      approved: await TradeMaster.countDocuments({ status: 'approved' }),
      suspended: await TradeMaster.countDocuments({ status: 'suspended' })
    };

    res.json({ success: true, data: masters, stats });
  } catch (error) {
    console.error('Get masters error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/copy-trade/masters/:id
// @desc    Get trade master details
// @access  Admin
router.get('/masters/:id', async (req, res) => {
  try {
    const master = await TradeMaster.findById(req.params.id)
      .populate('userId', 'firstName lastName email balance');

    if (!master) {
      return res.status(404).json({ success: false, message: 'Trade master not found' });
    }

    const followers = await CopyFollower.find({ masterId: master._id })
      .populate('userId', 'firstName lastName email balance');

    const recentTrades = await CopyTradeMap.find({ masterId: master._id })
      .sort({ createdAt: -1 })
      .limit(20);

    const commissions = await CommissionLog.find({ masterId: master._id })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      success: true,
      data: { master, followers, recentTrades, commissions }
    });
  } catch (error) {
    console.error('Get master details error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/copy-trade/masters/:id
// @desc    Update trade master
// @access  Admin
router.put('/masters/:id', async (req, res) => {
  try {
    const master = await TradeMaster.findById(req.params.id);
    if (!master) {
      return res.status(404).json({ success: false, message: 'Trade master not found' });
    }

    const {
      displayName,
      strategyType,
      description,
      commissionType,
      commissionValue,
      riskLevel,
      minCopyAmount,
      maxFollowers,
      isVerified
    } = req.body;

    if (displayName) master.displayName = displayName;
    if (strategyType) master.strategyType = strategyType;
    if (description) master.description = description;
    if (commissionType) master.commissionType = commissionType;
    if (commissionValue !== undefined) master.commissionValue = commissionValue;
    if (riskLevel) master.riskLevel = riskLevel;
    if (minCopyAmount !== undefined) master.minCopyAmount = minCopyAmount;
    if (maxFollowers !== undefined) master.maxFollowers = maxFollowers;
    if (isVerified !== undefined) master.isVerified = isVerified;

    await master.save();

    res.json({ success: true, message: 'Trade master updated', data: master });
  } catch (error) {
    console.error('Update master error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/copy-trade/masters/:id/suspend
// @desc    Suspend/Unsuspend trade master
// @access  Admin
router.put('/masters/:id/suspend', async (req, res) => {
  try {
    const master = await TradeMaster.findById(req.params.id);
    if (!master) {
      return res.status(404).json({ success: false, message: 'Trade master not found' });
    }

    const newStatus = master.status === 'suspended' ? 'approved' : 'suspended';
    master.status = newStatus;
    await master.save();

    // If suspended, pause all followers
    if (newStatus === 'suspended') {
      await CopyFollower.updateMany(
        { masterId: master._id, status: 'active' },
        { status: 'paused', pauseReason: 'Master suspended' }
      );
    }

    res.json({
      success: true,
      message: newStatus === 'suspended' ? 'Trade master suspended' : 'Trade master activated',
      data: master
    });
  } catch (error) {
    console.error('Suspend master error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== FOLLOWERS ===============

// @route   GET /api/admin/copy-trade/followers
// @desc    Get all copy followers
// @access  Admin
router.get('/followers', async (req, res) => {
  try {
    const { masterId, status } = req.query;
    
    const query = {};
    if (masterId) query.masterId = masterId;
    if (status) query.status = status;

    const followers = await CopyFollower.find(query)
      .populate('masterId', 'masterId displayName')
      .populate('userId', 'firstName lastName email balance')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: followers });
  } catch (error) {
    console.error('Get followers error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== COMMISSIONS ===============

// @route   GET /api/admin/copy-trade/commissions
// @desc    Get all commission logs
// @access  Admin
router.get('/commissions', async (req, res) => {
  try {
    const { masterId, status, limit = 100 } = req.query;
    
    const query = {};
    if (masterId) query.masterId = masterId;
    if (status) query.status = status;

    const commissions = await CommissionLog.find(query)
      .populate('masterId', 'masterId displayName')
      .populate('masterUserId', 'firstName lastName')
      .populate('followerUserId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    const totalCommissions = await CommissionLog.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
    ]);

    res.json({
      success: true,
      data: commissions,
      stats: {
        totalPaid: totalCommissions[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get commissions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =============== STATS ===============

// @route   GET /api/admin/copy-trade/stats
// @desc    Get copy trade statistics
// @access  Admin
router.get('/stats', async (req, res) => {
  try {
    const [
      totalMasters,
      activeMasters,
      totalFollowers,
      activeFollows,
      totalTrades,
      totalCommissions
    ] = await Promise.all([
      TradeMaster.countDocuments(),
      TradeMaster.countDocuments({ status: 'approved' }),
      CopyFollower.countDocuments(),
      CopyFollower.countDocuments({ status: 'active' }),
      CopyTradeMap.countDocuments(),
      CommissionLog.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$commissionAmount' } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        totalMasters,
        activeMasters,
        totalFollowers,
        activeFollows,
        totalTrades,
        totalCommissions: totalCommissions[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
