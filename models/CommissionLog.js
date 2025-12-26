const mongoose = require('mongoose');

const commissionLogSchema = new mongoose.Schema({
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
  followerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Trade Reference
  copyTradeMapId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CopyTradeMap'
  },
  masterTradeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trade'
  },
  followerTradeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trade'
  },
  
  // Commission Details
  commissionType: {
    type: String,
    enum: ['profit_share', 'per_lot', 'subscription'],
    required: true
  },
  tradePnL: {
    type: Number,
    default: 0
  },
  lotSize: {
    type: Number,
    default: 0
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
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  
  // Payment Details
  paidAt: Date,
  failReason: {
    type: String,
    default: ''
  },
  
  // Description
  description: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Indexes
commissionLogSchema.index({ masterId: 1 });
commissionLogSchema.index({ masterUserId: 1 });
commissionLogSchema.index({ followerUserId: 1 });
commissionLogSchema.index({ status: 1 });
commissionLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CommissionLog', commissionLogSchema);
