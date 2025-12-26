const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// @route   GET /api/transactions
// @desc    Get all transactions for current user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;
    
    const query = { user: req.user.id };
    if (type) query.type = type;
    if (status) query.status = status;

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Transaction.countDocuments(query);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/transactions/deposit
// @desc    Request deposit
// @access  Private
router.post('/deposit', protect, [
  body('amount').isFloat({ min: 10 }).withMessage('Minimum deposit is $10')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { amount, currency = 'USD' } = req.body;
    const user = await User.findById(req.user.id);

    const transaction = await Transaction.create({
      user: req.user.id,
      type: 'deposit',
      amount,
      currency,
      description: `Deposit request of ${amount} ${currency}`,
      balanceBefore: user.balance,
      balanceAfter: user.balance + amount,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message: 'Deposit request submitted. Awaiting admin approval.',
      data: transaction
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/transactions/withdraw
// @desc    Request withdrawal
// @access  Private
router.post('/withdraw', protect, [
  body('amount').isFloat({ min: 10 }).withMessage('Minimum withdrawal is $10')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { amount, currency = 'USD' } = req.body;
    const user = await User.findById(req.user.id);

    if (user.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    const transaction = await Transaction.create({
      user: req.user.id,
      type: 'withdrawal',
      amount: -amount,
      currency,
      description: `Withdrawal request of ${amount} ${currency}`,
      balanceBefore: user.balance,
      balanceAfter: user.balance - amount,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted. Awaiting admin approval.',
      data: transaction
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
