const mongoose = require('mongoose');

const tradeMasterSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  masterId: {
    type: String,
    unique: true
  },
  
  // Profile
  displayName: {
    type: String,
    required: true
  },
  avatar: {
    type: String,
    default: ''
  },
  strategyType: {
    type: String,
    default: 'General Trading'
  },
  description: {
    type: String,
    default: ''
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  
  // Commission Settings
  commissionType: {
    type: String,
    enum: ['profit_share', 'per_lot', 'subscription'],
    default: 'profit_share'
  },
  commissionValue: {
    type: Number,
    default: 20 // 20% profit share or $2 per lot
  },
  subscriptionFee: {
    type: Number,
    default: 0 // Monthly subscription fee
  },
  
  // Risk Profile
  riskLevel: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
  },
  maxDrawdown: {
    type: Number,
    default: 0
  },
  
  // Stats (updated periodically)
  stats: {
    totalFollowers: { type: Number, default: 0 },
    activeFollowers: { type: Number, default: 0 },
    totalTrades: { type: Number, default: 0 },
    winningTrades: { type: Number, default: 0 },
    losingTrades: { type: Number, default: 0 },
    winRate: { type: Number, default: 0 },
    totalPnL: { type: Number, default: 0 },
    profit7Days: { type: Number, default: 0 },
    profit30Days: { type: Number, default: 0 },
    totalCommissionEarned: { type: Number, default: 0 },
    availableCommission: { type: Number, default: 0 }
  },
  
  // Settings
  minCopyAmount: {
    type: Number,
    default: 100
  },
  maxFollowers: {
    type: Number,
    default: 1000
  },
  allowedCopyModes: [{
    type: String,
    enum: ['fixed_lot', 'multiplier', 'balance_ratio']
  }],
  
  // Timestamps
  approvedAt: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Generate unique master ID before saving
tradeMasterSchema.pre('save', async function(next) {
  if (!this.masterId) {
    const count = await this.constructor.countDocuments();
    this.masterId = `TM${String(count + 101).padStart(3, '0')}`;
  }
  if (!this.allowedCopyModes || this.allowedCopyModes.length === 0) {
    this.allowedCopyModes = ['fixed_lot', 'multiplier', 'balance_ratio'];
  }
  next();
});

// Update win rate
tradeMasterSchema.methods.updateStats = function() {
  const total = this.stats.winningTrades + this.stats.losingTrades;
  this.stats.winRate = total > 0 ? Math.round((this.stats.winningTrades / total) * 100) : 0;
};

// Indexes
tradeMasterSchema.index({ userId: 1 });
tradeMasterSchema.index({ status: 1 });
tradeMasterSchema.index({ masterId: 1 });

module.exports = mongoose.model('TradeMaster', tradeMasterSchema);
