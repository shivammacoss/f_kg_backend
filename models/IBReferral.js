const mongoose = require('mongoose');

const ibReferralSchema = new mongoose.Schema({
  ibId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IB',
    required: true
  },
  ibUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  referredUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // Each user can only be referred once
  },
  
  // Referral Details
  referralCode: {
    type: String,
    required: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'churned'],
    default: 'active'
  },
  
  // Stats (updated periodically)
  stats: {
    firstDeposit: { type: Number, default: 0 },
    totalDeposits: { type: Number, default: 0 },
    totalWithdrawals: { type: Number, default: 0 },
    totalTradingVolume: { type: Number, default: 0 }, // in lots
    totalTrades: { type: Number, default: 0 },
    commissionGenerated: { type: Number, default: 0 }
  },
  
  // First Deposit Tracking
  firstDepositProcessed: {
    type: Boolean,
    default: false
  },
  firstDepositDate: Date,
  
  // Timestamps
  registeredAt: {
    type: Date,
    default: Date.now
  },
  lastActivityAt: Date
}, {
  timestamps: true
});

// Indexes
ibReferralSchema.index({ ibId: 1 });
ibReferralSchema.index({ referredUserId: 1 });
ibReferralSchema.index({ ibUserId: 1 });
ibReferralSchema.index({ status: 1 });

module.exports = mongoose.model('IBReferral', ibReferralSchema);
