const mongoose = require('mongoose');

const tradingChargeSchema = new mongoose.Schema({
  // Scope type: 'global', 'segment', 'symbol', 'user'
  scopeType: {
    type: String,
    enum: ['global', 'segment', 'symbol', 'user'],
    required: true
  },
  
  // For segment scope: 'forex', 'crypto', 'metals', 'indices'
  segment: {
    type: String,
    enum: ['forex', 'crypto', 'metals', 'indices', null],
    default: null
  },
  
  // For symbol scope: specific symbol like 'EURUSD', 'XAUUSD'
  symbol: {
    type: String,
    uppercase: true,
    default: null
  },
  
  // For user scope: specific user
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Charge settings
  spreadPips: {
    type: Number,
    default: 0,
    min: 0
  },
  
  commissionPerLot: {
    type: Number,
    default: 0,
    min: 0
  },
  
  swapLong: {
    type: Number,
    default: 0
  },
  
  swapShort: {
    type: Number,
    default: 0
  },
  
  // Fee as percentage of trade value
  feePercentage: {
    type: Number,
    default: 0.1, // 0.1%
    min: 0
  },
  
  // Minimum fee in USD
  minFee: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Maximum fee in USD (0 = no limit)
  maxFee: {
    type: Number,
    default: 0,
    min: 0
  },

  isActive: {
    type: Boolean,
    default: true
  },
  
  description: String,
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Compound index for efficient lookups
tradingChargeSchema.index({ scopeType: 1, segment: 1, symbol: 1, userId: 1 });
tradingChargeSchema.index({ symbol: 1 });
tradingChargeSchema.index({ userId: 1 });

// Static method to get charges for a trade
tradingChargeSchema.statics.getChargesForTrade = async function(symbol, userId) {
  const segment = getSegmentForSymbol(symbol);
  
  // Priority: User > Symbol > Segment > Global
  const charges = await this.find({
    isActive: true,
    $or: [
      { scopeType: 'user', userId: userId },
      { scopeType: 'symbol', symbol: symbol.toUpperCase() },
      { scopeType: 'segment', segment: segment },
      { scopeType: 'global' }
    ]
  }).sort({ scopeType: 1 }); // user first, then symbol, segment, global

  // Merge charges with priority
  let finalCharges = {
    spreadPips: 0,
    commissionPerLot: 0,
    swapLong: 0,
    swapShort: 0,
    feePercentage: 0.1,
    minFee: 0,
    maxFee: 0,
    source: 'default'
  };

  // Apply in reverse priority (global first, then more specific)
  const sortedCharges = charges.sort((a, b) => {
    const priority = { global: 0, segment: 1, symbol: 2, user: 3 };
    return priority[a.scopeType] - priority[b.scopeType];
  });

  for (const charge of sortedCharges) {
    if (charge.spreadPips > 0) finalCharges.spreadPips = charge.spreadPips;
    if (charge.commissionPerLot > 0) finalCharges.commissionPerLot = charge.commissionPerLot;
    if (charge.swapLong !== 0) finalCharges.swapLong = charge.swapLong;
    if (charge.swapShort !== 0) finalCharges.swapShort = charge.swapShort;
    if (charge.feePercentage > 0) finalCharges.feePercentage = charge.feePercentage;
    if (charge.minFee > 0) finalCharges.minFee = charge.minFee;
    if (charge.maxFee > 0) finalCharges.maxFee = charge.maxFee;
    finalCharges.source = charge.scopeType;
  }

  return finalCharges;
};

// Helper function to determine segment from symbol
function getSegmentForSymbol(symbol) {
  const upperSymbol = symbol.toUpperCase();
  
  if (['XAUUSD', 'XAGUSD', 'XPTUSD', 'XPDUSD'].includes(upperSymbol)) {
    return 'metals';
  }
  
  if (['BTCUSD', 'ETHUSD', 'XRPUSD', 'LTCUSD', 'SOLUSD', 'DOGEUSD'].includes(upperSymbol)) {
    return 'crypto';
  }
  
  if (['US30', 'US500', 'NAS100', 'UK100', 'GER40'].includes(upperSymbol)) {
    return 'indices';
  }
  
  // Default to forex
  return 'forex';
}

module.exports = mongoose.model('TradingCharge', tradingChargeSchema);
