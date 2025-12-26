const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Transaction = require('../models/Transaction');
const UserBankAccount = require('../models/UserBankAccount');
const BankSettings = require('../models/BankSettings');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// @route   GET /api/wallet/bank-settings
// @desc    Get admin bank settings for deposit
// @access  Private
router.get('/bank-settings', async (req, res) => {
  try {
    const settings = await BankSettings.getSettings();
    res.json({
      success: true,
      data: {
        bankName: settings.bankName,
        accountNumber: settings.accountNumber,
        accountHolderName: settings.accountHolderName,
        ifscCode: settings.ifscCode,
        bankBranch: settings.bankBranch,
        upiId: settings.upiId,
        qrCode: settings.qrCode,
        paymentInstructions: settings.paymentInstructions,
        minDeposit: settings.minDeposit,
        maxDeposit: settings.maxDeposit,
        minWithdrawal: settings.minWithdrawal,
        maxWithdrawal: settings.maxWithdrawal
      }
    });
  } catch (error) {
    console.error('Get bank settings error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/wallet/deposit
// @desc    Create deposit request
// @access  Private
router.post('/deposit', [
  body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least 1'),
  body('paymentMethod').isIn(['bank', 'upi']).withMessage('Invalid payment method'),
  body('utrNumber').optional().isString(),
  body('transactionId').optional().isString(),
  body('screenshot').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { amount, paymentMethod, utrNumber, transactionId, screenshot } = req.body;

    // Check limits
    const settings = await BankSettings.getSettings();
    if (amount < settings.minDeposit || amount > settings.maxDeposit) {
      return res.status(400).json({
        success: false,
        message: `Deposit amount must be between $${settings.minDeposit} and $${settings.maxDeposit}`
      });
    }

    // Create deposit transaction
    const transaction = await Transaction.create({
      user: req.user._id,
      type: 'deposit',
      amount,
      paymentMethod,
      utrNumber: utrNumber || '',
      transactionId: transactionId || '',
      screenshot: screenshot || '',
      status: 'pending',
      description: `Deposit request via ${paymentMethod}`,
      balanceBefore: req.user.balance
    });

    res.status(201).json({
      success: true,
      message: 'Deposit request submitted successfully. Awaiting admin approval.',
      data: transaction
    });
  } catch (error) {
    console.error('Deposit request error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/wallet/withdraw
// @desc    Create withdrawal request
// @access  Private
router.post('/withdraw', [
  body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least 1'),
  body('withdrawalMethod').isIn(['bank', 'upi']).withMessage('Invalid withdrawal method'),
  body('bankAccountId').optional().isMongoId()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { amount, withdrawalMethod, bankAccountId, withdrawalDetails } = req.body;

    // Check limits
    const settings = await BankSettings.getSettings();
    if (amount < settings.minWithdrawal || amount > settings.maxWithdrawal) {
      return res.status(400).json({
        success: false,
        message: `Withdrawal amount must be between $${settings.minWithdrawal} and $${settings.maxWithdrawal}`
      });
    }

    // Check user balance
    const user = await User.findById(req.user._id);
    if (user.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance'
      });
    }

    // Get withdrawal details
    let finalWithdrawalDetails = withdrawalDetails || {};
    if (bankAccountId) {
      const bankAccount = await UserBankAccount.findOne({ 
        _id: bankAccountId, 
        userId: req.user._id,
        isActive: true
      });
      if (!bankAccount) {
        return res.status(400).json({
          success: false,
          message: 'Bank account not found'
        });
      }
      finalWithdrawalDetails = {
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
        accountHolderName: bankAccount.accountHolderName,
        ifscCode: bankAccount.ifscCode,
        upiId: bankAccount.upiId
      };
    }

    // Create withdrawal transaction
    const transaction = await Transaction.create({
      user: req.user._id,
      type: 'withdrawal',
      amount,
      withdrawalMethod,
      bankAccountId: bankAccountId || null,
      withdrawalDetails: finalWithdrawalDetails,
      status: 'pending',
      description: `Withdrawal request via ${withdrawalMethod}`,
      balanceBefore: user.balance
    });

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully. Awaiting admin approval.',
      data: transaction
    });
  } catch (error) {
    console.error('Withdrawal request error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/wallet/transactions
// @desc    Get user's transactions
// @access  Private
router.get('/transactions', async (req, res) => {
  try {
    const { type, status, limit = 20, page = 1 } = req.query;
    
    const query = { user: req.user._id };
    if (type) query.type = type;
    if (status) query.status = status;

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Transaction.countDocuments(query);

    res.json({
      success: true,
      data: transactions,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/wallet/bank-accounts
// @desc    Get user's saved bank accounts
// @access  Private
router.get('/bank-accounts', async (req, res) => {
  try {
    const accounts = await UserBankAccount.find({ 
      userId: req.user._id,
      isActive: true
    }).sort({ isDefault: -1, createdAt: -1 });

    res.json({ success: true, data: accounts });
  } catch (error) {
    console.error('Get bank accounts error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/wallet/bank-accounts
// @desc    Add new bank account
// @access  Private
router.post('/bank-accounts', [
  body('type').isIn(['bank', 'upi']).withMessage('Type must be bank or upi')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { type, bankName, accountNumber, accountHolderName, ifscCode, upiId, isDefault } = req.body;

    // Check if already exists
    const existingCount = await UserBankAccount.countDocuments({ 
      userId: req.user._id, 
      isActive: true 
    });
    
    if (existingCount >= 5) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 5 bank accounts allowed'
      });
    }

    const account = await UserBankAccount.create({
      userId: req.user._id,
      type,
      bankName: bankName || '',
      accountNumber: accountNumber || '',
      accountHolderName: accountHolderName || '',
      ifscCode: ifscCode || '',
      upiId: upiId || '',
      isDefault: isDefault || existingCount === 0
    });

    res.status(201).json({
      success: true,
      message: 'Bank account added successfully',
      data: account
    });
  } catch (error) {
    console.error('Add bank account error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/wallet/bank-accounts/:id
// @desc    Update bank account
// @access  Private
router.put('/bank-accounts/:id', async (req, res) => {
  try {
    const account = await UserBankAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    const { bankName, accountNumber, accountHolderName, ifscCode, upiId, isDefault } = req.body;

    if (bankName !== undefined) account.bankName = bankName;
    if (accountNumber !== undefined) account.accountNumber = accountNumber;
    if (accountHolderName !== undefined) account.accountHolderName = accountHolderName;
    if (ifscCode !== undefined) account.ifscCode = ifscCode;
    if (upiId !== undefined) account.upiId = upiId;
    if (isDefault !== undefined) account.isDefault = isDefault;

    await account.save();

    res.json({
      success: true,
      message: 'Bank account updated successfully',
      data: account
    });
  } catch (error) {
    console.error('Update bank account error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/wallet/bank-accounts/:id
// @desc    Delete bank account
// @access  Private
router.delete('/bank-accounts/:id', async (req, res) => {
  try {
    const account = await UserBankAccount.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found'
      });
    }

    account.isActive = false;
    await account.save();

    res.json({
      success: true,
      message: 'Bank account deleted successfully'
    });
  } catch (error) {
    console.error('Delete bank account error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/wallet/balance
// @desc    Get user's wallet balance
// @access  Private
router.get('/balance', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Get pending transactions
    const pendingDeposits = await Transaction.countDocuments({
      user: req.user._id,
      type: 'deposit',
      status: 'pending'
    });
    const pendingWithdrawals = await Transaction.countDocuments({
      user: req.user._id,
      type: 'withdrawal',
      status: 'pending'
    });

    res.json({
      success: true,
      data: {
        balance: user.balance,
        pendingDeposits,
        pendingWithdrawals
      }
    });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
