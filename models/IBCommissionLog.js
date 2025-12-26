const mongoose = require('mongoose');

const ibCommissionLogSchema = new mongoose.Schema({
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
  
  // Source User (who generated the commission)
  sourceUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Commission Source
  sourceType: {
    type: String,
    enum: ['trade', 'first_deposit', 'deposit', 'manual_adjustment'],
    required: true
  },
  
  // Trade Reference (if trade-based)
  tradeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trade'
  },
  symbol: String,
  lots: Number,
  
  // Deposit Reference (if deposit-based)
  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  depositAmount: Number,
  
  // Commission Details
  commissionType: {
    type: String,
    enum: ['per_lot', 'percentage_spread', 'percentage_profit', 'first_deposit', 'volume_tier', 'manual'],
    required: true
  },
  commissionRate: {
    type: Number,
    required: true
  },
  commissionAmount: {
    type: Number,
    required: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'credited', 'cancelled', 'reversed'],
    default: 'credited'
  },
  
  // Description
  description: {
    type: String,
    default: ''
  },
  
  // Admin Override
  isManualAdjustment: {
    type: Boolean,
    default: false
  },
  adjustedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Indexes
ibCommissionLogSchema.index({ ibId: 1, createdAt: -1 });
ibCommissionLogSchema.index({ ibUserId: 1 });
ibCommissionLogSchema.index({ sourceUserId: 1 });
ibCommissionLogSchema.index({ tradeId: 1 });
ibCommissionLogSchema.index({ status: 1 });

module.exports = mongoose.model('IBCommissionLog', ibCommissionLogSchema);
