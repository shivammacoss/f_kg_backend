const mongoose = require('mongoose');

const tradeMasterRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Application Details
  experienceYears: {
    type: Number,
    required: true
  },
  strategy: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  minCapital: {
    type: Number,
    default: 1000
  },
  
  // Preferred Settings
  preferredCommissionType: {
    type: String,
    enum: ['profit_share', 'per_lot', 'subscription'],
    default: 'profit_share'
  },
  preferredCommissionValue: {
    type: Number,
    default: 20
  },
  riskLevel: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
  },
  
  // Compliance
  riskDisclosureAccepted: {
    type: Boolean,
    default: false
  },
  termsAccepted: {
    type: Boolean,
    default: false
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  
  // Admin Response
  adminNote: {
    type: String,
    default: ''
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  processedAt: Date,
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Indexes
tradeMasterRequestSchema.index({ userId: 1 });
tradeMasterRequestSchema.index({ status: 1 });

module.exports = mongoose.model('TradeMasterRequest', tradeMasterRequestSchema);
