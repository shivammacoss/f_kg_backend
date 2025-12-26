const mongoose = require('mongoose');

const ibWithdrawalSchema = new mongoose.Schema({
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
  
  // Withdrawal Details
  amount: {
    type: Number,
    required: true
  },
  
  // Withdrawal Method
  method: {
    type: String,
    enum: ['wallet', 'bank', 'upi', 'crypto'],
    default: 'wallet'
  },
  
  // Bank/UPI Details (if not to wallet)
  withdrawalDetails: {
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    accountHolderName: String,
    upiId: String,
    cryptoAddress: String,
    cryptoNetwork: String
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed', 'cancelled'],
    default: 'pending'
  },
  
  // Processing
  processedAt: Date,
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  
  // Notes
  adminNote: {
    type: String,
    default: ''
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  
  // Transaction Reference
  transactionRef: String
}, {
  timestamps: true
});

// Indexes
ibWithdrawalSchema.index({ ibId: 1, createdAt: -1 });
ibWithdrawalSchema.index({ status: 1 });

module.exports = mongoose.model('IBWithdrawal', ibWithdrawalSchema);
