const mongoose = require('mongoose');

const userBankAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Account type
  type: {
    type: String,
    enum: ['bank', 'upi'],
    required: true
  },
  
  // Bank Account Details (for type: 'bank')
  bankName: {
    type: String,
    default: ''
  },
  accountNumber: {
    type: String,
    default: ''
  },
  accountHolderName: {
    type: String,
    default: ''
  },
  ifscCode: {
    type: String,
    default: ''
  },
  
  // UPI Details (for type: 'upi')
  upiId: {
    type: String,
    default: ''
  },
  
  // Common fields
  isDefault: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for faster queries
userBankAccountSchema.index({ userId: 1, type: 1 });

// Set only one default per user per type
userBankAccountSchema.pre('save', async function(next) {
  if (this.isDefault) {
    await this.constructor.updateMany(
      { userId: this.userId, type: this.type, _id: { $ne: this._id } },
      { isDefault: false }
    );
  }
  next();
});

module.exports = mongoose.model('UserBankAccount', userBankAccountSchema);
