const mongoose = require('mongoose');

const copyTradeMapSchema = new mongoose.Schema({
  // Master Trade Reference
  masterTradeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trade',
    required: true
  },
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
  
  // Follower Trade Reference
  followerTradeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trade',
    required: true
  },
  followerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CopyFollower',
    required: true
  },
  followerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Trade Details (snapshot at copy time)
  symbol: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  masterLot: {
    type: Number,
    required: true
  },
  followerLot: {
    type: Number,
    required: true
  },
  copyMode: {
    type: String,
    enum: ['fixed_lot', 'multiplier', 'balance_ratio'],
    required: true
  },
  entryPrice: {
    type: Number,
    required: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['open', 'closed', 'failed', 'partial_closed'],
    default: 'open'
  },
  failReason: {
    type: String,
    default: ''
  },
  
  // PnL & Commission
  masterPnL: {
    type: Number,
    default: 0
  },
  followerPnL: {
    type: Number,
    default: 0
  },
  commissionAmount: {
    type: Number,
    default: 0
  },
  commissionPaid: {
    type: Boolean,
    default: false
  },
  
  // Timestamps
  openedAt: {
    type: Date,
    default: Date.now
  },
  closedAt: Date,
  
  // Execution Details
  executionDelay: {
    type: Number, // milliseconds
    default: 0
  },
  slippage: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for fast lookups
copyTradeMapSchema.index({ masterTradeId: 1 });
copyTradeMapSchema.index({ followerTradeId: 1 });
copyTradeMapSchema.index({ masterId: 1, status: 1 });
copyTradeMapSchema.index({ followerUserId: 1, status: 1 });

module.exports = mongoose.model('CopyTradeMap', copyTradeMapSchema);
