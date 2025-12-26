const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  clientId: {
    type: String,
    default: null
  },
  tradeSource: {
    type: String,
    enum: ['manual', 'copied', 'admin'],
    default: 'manual'
  },
  isCopiedTrade: {
    type: Boolean,
    default: false
  },
  masterTradeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trade',
    default: null
  },
  symbol: {
    type: String,
    required: [true, 'Trading symbol is required'],
    uppercase: true
  },
  type: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  orderType: {
    type: String,
    enum: ['market', 'limit', 'stop', 'stop-loss', 'take-profit'],
    default: 'market'
  },
  amount: {
    type: Number,
    required: [true, 'Amount/Lot size is required'],
    min: 0.01
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: 0
  },
  leverage: {
    type: Number,
    default: 100,
    min: 1,
    max: 500
  },
  margin: {
    type: Number,
    default: 0
  },
  spread: {
    type: Number,
    default: 0
  },
  spreadCost: {
    type: Number,
    default: 0
  },
  commission: {
    type: Number,
    default: 0
  },
  stopLoss: {
    type: Number,
    default: null
  },
  takeProfit: {
    type: Number,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'open', 'closed', 'cancelled'],
    default: 'pending'
  },
  closePrice: {
    type: Number,
    default: null
  },
  closeReason: {
    type: String,
    enum: ['manual', 'stop_loss', 'take_profit', 'stop_out', 'margin_call', 'master_closed', 'copied', null],
    default: null
  },
  profit: {
    type: Number,
    default: 0
  },
  fee: {
    type: Number,
    default: 0
  },
  activatedAt: {
    type: Date,
    default: null
  },
  closedAt: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Calculate profit/loss
tradeSchema.methods.calculatePL = function(currentPrice) {
  if (this.type === 'buy') {
    return (currentPrice - this.price) * this.amount * this.leverage;
  } else {
    return (this.price - currentPrice) * this.amount * this.leverage;
  }
};

// Index for faster queries
tradeSchema.index({ user: 1, status: 1 });
tradeSchema.index({ symbol: 1, createdAt: -1 });
tradeSchema.index({ clientId: 1 });
tradeSchema.index({ masterTradeId: 1 });

module.exports = mongoose.model('Trade', tradeSchema);
