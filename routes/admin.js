const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Trade = require('../models/Trade');
const Transaction = require('../models/Transaction');
const { protectAdmin } = require('./adminAuth');
const { exportAllCollections, createBackup } = require('../config/db');

// All routes require admin authentication
router.use(protectAdmin);

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard stats
// @access  Admin
router.get('/dashboard', async (req, res) => {
  try {
    console.log('[Admin Dashboard] Fetching stats...');
    
    const [
      totalUsers,
      totalUserFund,
      pendingDeposits,
      pendingWithdrawals,
      totalCharges,
      tradePnL
    ] = await Promise.all([
      // Total Users (count all users, not just role: 'user')
      User.countDocuments(),
      
      // Total User Fund (sum of all user balances)
      User.aggregate([
        { $group: { _id: null, total: { $sum: '$balance' } } }
      ]),
      
      // Pending Deposit Requests
      Transaction.countDocuments({ type: 'deposit', status: 'pending' }),
      
      // Pending Withdrawal Requests
      Transaction.countDocuments({ type: 'withdrawal', status: 'pending' }),
      
      // Total Earnings in Charges (fees + commission + spread)
      Trade.aggregate([
        { $group: { 
          _id: null, 
          totalFees: { $sum: '$fee' },
          totalCommission: { $sum: '$commission' },
          totalSpread: { $sum: '$spreadCost' }
        }}
      ]),
      
      // Total Win/Loss for broker profit calculation
      Trade.aggregate([
        { $match: { status: 'closed' } },
        { $group: { 
          _id: null, 
          totalWin: { $sum: { $cond: [{ $gt: ['$profit', 0] }, '$profit', 0] } },
          totalLoss: { $sum: { $cond: [{ $lt: ['$profit', 0] }, { $abs: '$profit' }, 0] } }
        }}
      ])
    ]);

    const charges = totalCharges[0] || { totalFees: 0, totalCommission: 0, totalSpread: 0 };
    const pnl = tradePnL[0] || { totalWin: 0, totalLoss: 0 };
    const totalEarnings = (charges.totalFees || 0) + (charges.totalCommission || 0) + (charges.totalSpread || 0);
    const brokerProfit = (pnl.totalLoss || 0) - (pnl.totalWin || 0);

    const responseData = {
      totalUsers,
      totalUserFund: totalUserFund[0]?.total || 0,
      pendingDeposits,
      pendingWithdrawals,
      totalEarnings,
      brokerProfit,
      totalWin: pnl.totalWin || 0,
      totalLoss: pnl.totalLoss || 0
    };

    console.log('[Admin Dashboard] Stats:', responseData);

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users
// @access  Admin
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    
    const query = { role: 'user' };
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } }
      ];
    }
    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;

    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/admin/users/:id
// @desc    Update user
// @access  Admin
router.put('/users/:id', async (req, res) => {
  try {
    const { balance, isActive, isVerified } = req.body;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { balance, isActive, isVerified },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/admin/transactions/pending
// @desc    Get pending transactions
// @access  Admin
router.get('/transactions/pending', async (req, res) => {
  try {
    const transactions = await Transaction.find({ status: 'pending' })
      .populate('user', 'email firstName lastName balance')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error('Get pending transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/admin/transactions/:id/approve
// @desc    Approve transaction
// @access  Admin
router.put('/transactions/:id/approve', async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    if (transaction.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Transaction already processed'
      });
    }

    // Update user balance
    const user = await User.findById(transaction.user);
    if (transaction.type === 'deposit') {
      user.balance += transaction.amount;
    } else if (transaction.type === 'withdrawal') {
      if (user.balance < Math.abs(transaction.amount)) {
        return res.status(400).json({
          success: false,
          message: 'User has insufficient balance'
        });
      }
      user.balance -= Math.abs(transaction.amount);
    }
    await user.save();

    // Update transaction
    transaction.status = 'completed';
    transaction.processedAt = new Date();
    transaction.processedBy = req.user.id;
    transaction.balanceAfter = user.balance;
    await transaction.save();

    res.json({
      success: true,
      message: 'Transaction approved',
      data: transaction
    });
  } catch (error) {
    console.error('Approve transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/admin/transactions/:id/reject
// @desc    Reject transaction
// @access  Admin
router.put('/transactions/:id/reject', async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    transaction.status = 'cancelled';
    transaction.processedAt = new Date();
    transaction.processedBy = req.user.id;
    await transaction.save();

    res.json({
      success: true,
      message: 'Transaction rejected',
      data: transaction
    });
  } catch (error) {
    console.error('Reject transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/admin/backup
// @desc    Create database backup
// @access  Admin
router.post('/backup', async (req, res) => {
  try {
    const backupPath = await createBackup();
    res.json({
      success: true,
      message: 'Backup created successfully',
      data: { path: backupPath }
    });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({
      success: false,
      message: 'Backup failed'
    });
  }
});

// @route   GET /api/admin/trades
// @desc    Get all trades
// @access  Admin
router.get('/trades', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, userId } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (userId) query.user = userId;

    const trades = await Trade.find(query)
      .populate('user', 'email firstName lastName')
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
    console.error('Get all trades error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
