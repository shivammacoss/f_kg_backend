const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['deposit', 'withdrawal', 'trade_profit', 'trade_loss', 'fee', 'bonus', 'referral', 'margin_deduction', 'margin_release', 'commission', 'spread_cost', 'swap'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'USD'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'completed', 'rejected', 'failed', 'cancelled'],
    default: 'pending'
  },
  reference: {
    type: String,
    unique: true
  },
  description: {
    type: String,
    default: ''
  },
  
  // Deposit specific fields
  paymentMethod: {
    type: String,
    enum: ['bank', 'upi', 'other'],
    default: 'bank'
  },
  utrNumber: {
    type: String,
    default: ''
  },
  transactionId: {
    type: String,
    default: ''
  },
  screenshot: {
    type: String,  // Base64 or URL
    default: ''
  },
  
  // Withdrawal specific fields
  withdrawalMethod: {
    type: String,
    enum: ['bank', 'upi'],
    default: 'bank'
  },
  bankAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserBankAccount',
    default: null
  },
  withdrawalDetails: {
    bankName: String,
    accountNumber: String,
    accountHolderName: String,
    ifscCode: String,
    upiId: String
  },
  
  // Balance tracking
  balanceBefore: {
    type: Number,
    default: 0
  },
  balanceAfter: {
    type: Number,
    default: 0
  },
  
  // Admin notes
  adminNote: {
    type: String,
    default: ''
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  processedAt: {
    type: Date,
    default: null
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  }
}, {
  timestamps: true
});

// Generate unique reference before saving
transactionSchema.pre('save', function(next) {
  if (!this.reference) {
    this.reference = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }
  next();
});

// Index for faster queries
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ reference: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
