const mongoose = require('mongoose');

const copyFollowerSchema = new mongoose.Schema({
  masterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TradeMaster',
    required: true
  },
  masterUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Copy Settings
  copyMode: {
    type: String,
    enum: ['fixed_lot', 'multiplier', 'balance_ratio'],
    required: true
  },
  fixedLot: {
    type: Number,
    default: 0.01
  },
  multiplier: {
    type: Number,
    default: 1.0
  },
  
  // Risk Management
  maxDailyLossPercent: {
    type: Number,
    default: 10
  },
  maxDrawdownPercent: {
    type: Number,
    default: 30
  },
  maxLotSize: {
    type: Number,
    default: 10
  },
  stopCopyOnDrawdown: {
    type: Boolean,
    default: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'paused', 'stopped'],
    default: 'active'
  },
  pauseReason: {
    type: String,
    default: ''
  },
  
  // Stats
  stats: {
    totalCopiedTrades: { type: Number, default: 0 },
    successfulCopies: { type: Number, default: 0 },
    failedCopies: { type: Number, default: 0 },
    totalPnL: { type: Number, default: 0 },
    totalCommissionPaid: { type: Number, default: 0 },
    currentDrawdown: { type: Number, default: 0 },
    dailyLoss: { type: Number, default: 0 },
    lastDailyReset: { type: Date, default: Date.now }
  },
  
  // Timestamps
  startedAt: {
    type: Date,
    default: Date.now
  },
  stoppedAt: Date
}, {
  timestamps: true
});

// Prevent user from following themselves
copyFollowerSchema.pre('save', function(next) {
  if (this.userId.toString() === this.masterUserId.toString()) {
    return next(new Error('Cannot follow yourself'));
  }
  next();
});

// Reset daily loss at midnight
copyFollowerSchema.methods.resetDailyLoss = function() {
  const now = new Date();
  const lastReset = new Date(this.stats.lastDailyReset);
  if (now.toDateString() !== lastReset.toDateString()) {
    this.stats.dailyLoss = 0;
    this.stats.lastDailyReset = now;
  }
};

// Check if copy should be paused due to risk limits
copyFollowerSchema.methods.checkRiskLimits = function() {
  const dailyLossExceeded = Math.abs(this.stats.dailyLoss) >= this.maxDailyLossPercent;
  const drawdownExceeded = Math.abs(this.stats.currentDrawdown) >= this.maxDrawdownPercent;
  
  if (this.stopCopyOnDrawdown && (dailyLossExceeded || drawdownExceeded)) {
    this.status = 'paused';
    this.pauseReason = dailyLossExceeded ? 'Daily loss limit exceeded' : 'Drawdown limit exceeded';
    return true;
  }
  return false;
};

// Indexes
copyFollowerSchema.index({ masterId: 1, userId: 1 }, { unique: true });
copyFollowerSchema.index({ userId: 1 });
copyFollowerSchema.index({ status: 1 });

module.exports = mongoose.model('CopyFollower', copyFollowerSchema);
