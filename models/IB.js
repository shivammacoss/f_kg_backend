const mongoose = require('mongoose');

const ibSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  
  // IB Identity
  ibId: {
    type: String,
    unique: true
  },
  referralCode: {
    type: String,
    unique: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'pending'],
    default: 'active'
  },
  
  // Commission Settings (can be overridden by admin)
  commissionType: {
    type: String,
    enum: ['per_lot', 'percentage_spread', 'percentage_profit', 'first_deposit', 'volume_tier', 'hybrid'],
    default: 'per_lot'
  },
  commissionValue: {
    type: Number,
    default: 5 // $5 per lot or 5% depending on type
  },
  
  // First Deposit Commission
  firstDepositCommission: {
    enabled: { type: Boolean, default: false },
    percentage: { type: Number, default: 10 }
  },
  
  // Wallet
  wallet: {
    balance: { type: Number, default: 0 },
    pendingBalance: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 }
  },
  
  // Stats
  stats: {
    totalReferrals: { type: Number, default: 0 },
    activeReferrals: { type: Number, default: 0 },
    totalDeposits: { type: Number, default: 0 },
    totalTradingVolume: { type: Number, default: 0 }
  },
  
  // Settings
  minWithdrawal: {
    type: Number,
    default: 50
  },
  requireWithdrawalApproval: {
    type: Boolean,
    default: true
  },
  
  // Admin Controls
  commissionFrozen: {
    type: Boolean,
    default: false
  },
  adminNote: {
    type: String,
    default: ''
  },
  
  // Timestamps
  activatedAt: Date,
  activatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Generate unique IB ID and referral code before saving
ibSchema.pre('save', async function(next) {
  if (!this.ibId) {
    const count = await this.constructor.countDocuments();
    this.ibId = `IB${String(count + 1001).padStart(4, '0')}`;
  }
  if (!this.referralCode) {
    this.referralCode = `Forex KG-${this.ibId}`;
  }
  next();
});

// Get referral link
ibSchema.methods.getReferralLink = function(baseUrl = 'https://Forex KG.com') {
  return `${baseUrl}/register?ref=${this.ibId}`;
};

// Indexes (userId, ibId, referralCode already have unique:true which creates indexes)
ibSchema.index({ status: 1 });

module.exports = mongoose.model('IB', ibSchema);
