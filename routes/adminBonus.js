const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const BonusSettings = require('../models/BonusSettings');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { protectAdmin } = require('./adminAuth');

// All routes require admin authentication
router.use(protectAdmin);

// @route   GET /api/admin/bonus/settings
// @desc    Get bonus settings
// @access  Admin
router.get('/settings', async (req, res) => {
  try {
    const settings = await BonusSettings.getSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Get bonus settings error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/bonus/settings
// @desc    Update bonus settings
// @access  Admin
router.put('/settings', async (req, res) => {
  try {
    const {
      isEnabled,
      regularBonusPercent,
      firstDepositBonusPercent,
      firstDepositBonusEnabled,
      minDepositForBonus,
      maxBonusAmount,
      bonusWithdrawable,
      withdrawalVolumeMultiplier,
      bonusExpiryDays,
      useTierBonus
    } = req.body;

    let settings = await BonusSettings.getSettings();

    if (isEnabled !== undefined) settings.isEnabled = isEnabled;
    if (regularBonusPercent !== undefined) settings.regularBonusPercent = regularBonusPercent;
    if (firstDepositBonusPercent !== undefined) settings.firstDepositBonusPercent = firstDepositBonusPercent;
    if (firstDepositBonusEnabled !== undefined) settings.firstDepositBonusEnabled = firstDepositBonusEnabled;
    if (minDepositForBonus !== undefined) settings.minDepositForBonus = minDepositForBonus;
    if (maxBonusAmount !== undefined) settings.maxBonusAmount = maxBonusAmount;
    if (bonusWithdrawable !== undefined) settings.bonusWithdrawable = bonusWithdrawable;
    if (withdrawalVolumeMultiplier !== undefined) settings.withdrawalVolumeMultiplier = withdrawalVolumeMultiplier;
    if (bonusExpiryDays !== undefined) settings.bonusExpiryDays = bonusExpiryDays;
    if (useTierBonus !== undefined) settings.useTierBonus = useTierBonus;
    
    settings.updatedBy = req.admin._id;
    await settings.save();

    res.json({
      success: true,
      message: 'Bonus settings updated successfully',
      data: settings
    });
  } catch (error) {
    console.error('Update bonus settings error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/bonus/tiers
// @desc    Add a bonus tier
// @access  Admin
router.post('/tiers', [
  body('minDeposit').isFloat({ min: 0 }).withMessage('Min deposit must be a positive number'),
  body('maxDeposit').isFloat({ min: 0 }).withMessage('Max deposit must be a positive number'),
  body('bonusPercent').isFloat({ min: 0, max: 100 }).withMessage('Bonus percent must be between 0 and 100')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { minDeposit, maxDeposit, bonusPercent } = req.body;

    if (minDeposit >= maxDeposit) {
      return res.status(400).json({ 
        success: false, 
        message: 'Min deposit must be less than max deposit' 
      });
    }

    let settings = await BonusSettings.getSettings();
    
    // Check for overlapping tiers
    const hasOverlap = settings.bonusTiers.some(tier => 
      (minDeposit >= tier.minDeposit && minDeposit <= tier.maxDeposit) ||
      (maxDeposit >= tier.minDeposit && maxDeposit <= tier.maxDeposit) ||
      (minDeposit <= tier.minDeposit && maxDeposit >= tier.maxDeposit)
    );

    if (hasOverlap) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tier range overlaps with existing tier' 
      });
    }

    settings.bonusTiers.push({
      minDeposit,
      maxDeposit,
      bonusPercent,
      isActive: true
    });

    settings.updatedBy = req.admin._id;
    await settings.save();

    res.json({
      success: true,
      message: 'Bonus tier added successfully',
      data: settings
    });
  } catch (error) {
    console.error('Add bonus tier error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/bonus/tiers/:index
// @desc    Update a bonus tier
// @access  Admin
router.put('/tiers/:index', async (req, res) => {
  try {
    const { index } = req.params;
    const { minDeposit, maxDeposit, bonusPercent, isActive } = req.body;

    let settings = await BonusSettings.getSettings();

    if (index < 0 || index >= settings.bonusTiers.length) {
      return res.status(404).json({ success: false, message: 'Tier not found' });
    }

    if (minDeposit !== undefined) settings.bonusTiers[index].minDeposit = minDeposit;
    if (maxDeposit !== undefined) settings.bonusTiers[index].maxDeposit = maxDeposit;
    if (bonusPercent !== undefined) settings.bonusTiers[index].bonusPercent = bonusPercent;
    if (isActive !== undefined) settings.bonusTiers[index].isActive = isActive;

    settings.updatedBy = req.admin._id;
    await settings.save();

    res.json({
      success: true,
      message: 'Bonus tier updated successfully',
      data: settings
    });
  } catch (error) {
    console.error('Update bonus tier error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/admin/bonus/tiers/:index
// @desc    Delete a bonus tier
// @access  Admin
router.delete('/tiers/:index', async (req, res) => {
  try {
    const { index } = req.params;

    let settings = await BonusSettings.getSettings();

    if (index < 0 || index >= settings.bonusTiers.length) {
      return res.status(404).json({ success: false, message: 'Tier not found' });
    }

    settings.bonusTiers.splice(index, 1);
    settings.updatedBy = req.admin._id;
    await settings.save();

    res.json({
      success: true,
      message: 'Bonus tier deleted successfully',
      data: settings
    });
  } catch (error) {
    console.error('Delete bonus tier error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/bonus/stats
// @desc    Get bonus statistics
// @access  Admin
router.get('/stats', async (req, res) => {
  try {
    const [
      totalBonusGiven,
      usersWithBonus,
      bonusTransactions
    ] = await Promise.all([
      User.aggregate([
        { $group: { _id: null, total: { $sum: '$totalBonusReceived' } } }
      ]),
      User.countDocuments({ bonusBalance: { $gt: 0 } }),
      Transaction.countDocuments({ type: 'deposit', status: 'completed', bonusAmount: { $gt: 0 } })
    ]);

    res.json({
      success: true,
      data: {
        totalBonusGiven: totalBonusGiven[0]?.total || 0,
        usersWithBonus,
        bonusTransactions
      }
    });
  } catch (error) {
    console.error('Get bonus stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/bonus/users
// @desc    Get users with bonus balance
// @access  Admin
router.get('/users', async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;

    const users = await User.find({ totalBonusReceived: { $gt: 0 } })
      .select('firstName lastName email balance bonusBalance totalBonusReceived tradingVolumeForBonus')
      .sort({ bonusBalance: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await User.countDocuments({ totalBonusReceived: { $gt: 0 } });

    res.json({
      success: true,
      data: users,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get bonus users error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/bonus/users/:userId/adjust
// @desc    Manually adjust user bonus balance
// @access  Admin
router.put('/users/:userId/adjust', [
  body('amount').isFloat().withMessage('Amount must be a number'),
  body('reason').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { userId } = req.params;
    const { amount, reason } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const newBonusBalance = user.bonusBalance + amount;
    if (newBonusBalance < 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Adjustment would result in negative bonus balance' 
      });
    }

    user.bonusBalance = newBonusBalance;
    if (amount > 0) {
      user.totalBonusReceived += amount;
    }
    await user.save();

    // Create a transaction record for the adjustment
    await Transaction.create({
      user: userId,
      type: 'bonus',
      amount: amount,
      status: 'completed',
      description: reason || `Manual bonus adjustment by admin`,
      balanceBefore: user.bonusBalance - amount,
      balanceAfter: user.bonusBalance,
      processedAt: new Date(),
      processedBy: req.admin._id
    });

    res.json({
      success: true,
      message: `Bonus ${amount >= 0 ? 'added' : 'deducted'} successfully`,
      data: {
        userId: user._id,
        bonusBalance: user.bonusBalance,
        totalBonusReceived: user.totalBonusReceived
      }
    });
  } catch (error) {
    console.error('Adjust user bonus error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   GET /api/admin/bonus/calculate
// @desc    Preview bonus calculation for an amount
// @access  Admin
router.get('/calculate', async (req, res) => {
  try {
    const { amount, isFirstDeposit } = req.query;
    
    if (!amount || isNaN(amount)) {
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }

    const settings = await BonusSettings.getSettings();
    const bonusAmount = settings.calculateBonus(
      parseFloat(amount), 
      isFirstDeposit === 'true'
    );

    res.json({
      success: true,
      data: {
        depositAmount: parseFloat(amount),
        bonusAmount,
        totalCredit: parseFloat(amount) + bonusAmount,
        isFirstDeposit: isFirstDeposit === 'true'
      }
    });
  } catch (error) {
    console.error('Calculate bonus error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
