const mongoose = require('mongoose');

const bankSettingsSchema = new mongoose.Schema({
  // Bank Account Details
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
  bankBranch: {
    type: String,
    default: ''
  },
  
  // UPI Details
  upiId: {
    type: String,
    default: ''
  },
  
  // QR Code (base64 or URL)
  qrCode: {
    type: String,
    default: ''
  },
  
  // Additional payment methods
  paymentInstructions: {
    type: String,
    default: ''
  },
  
  // Minimum/Maximum limits
  minDeposit: {
    type: Number,
    default: 100
  },
  maxDeposit: {
    type: Number,
    default: 100000
  },
  minWithdrawal: {
    type: Number,
    default: 100
  },
  maxWithdrawal: {
    type: Number,
    default: 50000
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Ensure only one settings document exists
bankSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model('BankSettings', bankSettingsSchema);
