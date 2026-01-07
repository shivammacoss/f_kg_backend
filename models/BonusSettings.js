const mongoose = require('mongoose');

const bonusSettingsSchema = new mongoose.Schema({
  // Global bonus toggle
  isEnabled: {
    type: Boolean,
    default: true
  },
  
  // Regular deposit bonus (percentage)
  regularBonusPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  // Special/First deposit bonus (percentage)
  firstDepositBonusPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  // Enable first deposit bonus
  firstDepositBonusEnabled: {
    type: Boolean,
    default: false
  },
  
  // Minimum deposit amount to qualify for bonus
  minDepositForBonus: {
    type: Number,
    default: 100
  },
  
  // Maximum bonus amount cap (0 = no cap)
  maxBonusAmount: {
    type: Number,
    default: 0
  },
  
  // Bonus withdrawal conditions
  bonusWithdrawable: {
    type: Boolean,
    default: false
  },
  
  // Required trading volume multiplier to withdraw bonus (e.g., 3x means trade 3x bonus amount)
  withdrawalVolumeMultiplier: {
    type: Number,
    default: 3
  },
  
  // Bonus expiry in days (0 = no expiry)
  bonusExpiryDays: {
    type: Number,
    default: 30
  },
  
  // Custom bonus tiers based on deposit amount
  bonusTiers: [{
    minDeposit: {
      type: Number,
      required: true
    },
    maxDeposit: {
      type: Number,
      required: true
    },
    bonusPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  
  // Use tier-based bonus instead of flat percentage
  useTierBonus: {
    type: Boolean,
    default: false
  },
  
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Ensure only one settings document exists (singleton pattern)
bonusSettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

// Calculate bonus for a deposit amount
bonusSettingsSchema.methods.calculateBonus = function(depositAmount, isFirstDeposit = false) {
  if (!this.isEnabled) return 0;
  if (depositAmount < this.minDepositForBonus) return 0;
  
  let bonusPercent = 0;
  
  // Check if first deposit bonus applies
  if (isFirstDeposit && this.firstDepositBonusEnabled) {
    bonusPercent = this.firstDepositBonusPercent;
  } else if (this.useTierBonus && this.bonusTiers.length > 0) {
    // Find applicable tier
    const applicableTier = this.bonusTiers.find(tier => 
      tier.isActive && 
      depositAmount >= tier.minDeposit && 
      depositAmount <= tier.maxDeposit
    );
    if (applicableTier) {
      bonusPercent = applicableTier.bonusPercent;
    }
  } else {
    // Use regular flat bonus
    bonusPercent = this.regularBonusPercent;
  }
  
  let bonusAmount = (depositAmount * bonusPercent) / 100;
  
  // Apply max cap if set
  if (this.maxBonusAmount > 0 && bonusAmount > this.maxBonusAmount) {
    bonusAmount = this.maxBonusAmount;
  }
  
  return Math.round(bonusAmount * 100) / 100; // Round to 2 decimal places
};

module.exports = mongoose.model('BonusSettings', bonusSettingsSchema);
