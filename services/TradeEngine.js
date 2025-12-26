/**
 * Trade Engine - Handles order execution, SL/TP monitoring, margin calls
 * Data provider to be configured separately
 */

const Trade = require('../models/Trade');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const TradingCharge = require('../models/TradingCharge');

// In-memory price storage (to be fed by external data provider)
const prices = {};

class TradeEngine {
  constructor(io) {
    this.io = io;
    this.isRunning = false;
    this.checkInterval = null;
    this.userSockets = new Map();
    this.prices = prices;
  }

  /**
   * Update price from external source
   */
  updatePrice(symbol, priceData) {
    this.prices[symbol] = {
      ...priceData,
      timestamp: Date.now()
    };
  }

  /**
   * Start the trade engine
   */
  start() {
    if (this.isRunning) return;

    // Check orders every 100ms for fast SL/TP execution
    this.checkInterval = setInterval(() => {
      this.checkPendingOrders();
      this.checkOpenPositions();
    }, 100);

    this.isRunning = true;
    console.log('[TradeEngine] Started - checking SL/TP every 100ms');
  }

  /**
   * Stop the trade engine
   */
  stop() {
    if (!this.isRunning) return;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.isRunning = false;
    console.log('[TradeEngine] Stopped');
  }

  /**
   * Set Socket.IO instance
   */
  setSocketIO(io) {
    this.io = io;
  }

  /**
   * Register user socket
   */
  registerUserSocket(userId, socketId) {
    this.userSockets.set(userId.toString(), socketId);
  }

  /**
   * Unregister user socket
   */
  unregisterUserSocket(userId) {
    this.userSockets.delete(userId.toString());
  }

  /**
   * Handle price updates - broadcast to clients
   */
  onPriceUpdate(prices) {
    if (this.io) {
      this.io.emit('priceUpdate', prices);
    }
  }

  /**
   * Get current price for symbol
   */
  getPrice(symbol) {
    return this.prices[symbol] || null;
  }

  /**
   * Get all prices
   */
  getAllPrices() {
    return this.prices;
  }

  /**
   * Execute market order
   */
  async executeMarketOrder(userId, orderData) {
    const { symbol, type, amount, leverage = 1, stopLoss, takeProfit } = orderData;
    
    const price = this.getPrice(symbol);
    if (!price) {
      throw new Error(`Invalid symbol: ${symbol}`);
    }

    // Get execution price (ask for buy, bid for sell)
    const executionPrice = type === 'buy' ? price.ask : price.bid;
    
    // Get charges for this trade
    const charges = await this.getChargesForTrade(symbol, userId);
    
    // Calculate margin required
    const margin = this.calculateMargin(symbol, amount, executionPrice, leverage);
    
    // Calculate fees and costs
    const feePercentage = charges.feePercentage / 100;
    let fee = margin * feePercentage;
    if (charges.minFee > 0 && fee < charges.minFee) fee = charges.minFee;
    if (charges.maxFee > 0 && fee > charges.maxFee) fee = charges.maxFee;
    
    const commission = charges.commissionPerLot * amount;
    const spreadCost = this.calculateSpreadCost(symbol, amount, charges.spreadPips);
    
    const totalRequired = margin + fee + commission + spreadCost;

    // Check user balance
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    if (user.balance < totalRequired) {
      throw new Error(`Insufficient balance. Required: $${totalRequired.toFixed(2)}, Available: $${user.balance.toFixed(2)}`);
    }

    // Validate SL/TP
    if (stopLoss) {
      if (type === 'buy' && stopLoss >= executionPrice) {
        throw new Error('Stop Loss must be below entry price for buy orders');
      }
      if (type === 'sell' && stopLoss <= executionPrice) {
        throw new Error('Stop Loss must be above entry price for sell orders');
      }
    }
    if (takeProfit) {
      if (type === 'buy' && takeProfit <= executionPrice) {
        throw new Error('Take Profit must be above entry price for buy orders');
      }
      if (type === 'sell' && takeProfit >= executionPrice) {
        throw new Error('Take Profit must be below entry price for sell orders');
      }
    }

    // Generate client ID
    const clientId = `${user.firstName?.substring(0,2) || 'US'}${user._id.toString().slice(-6)}`.toUpperCase();

    console.log(`[TradeEngine] Creating trade for user ${userId}: ${type} ${amount} ${symbol} @ ${executionPrice}`);
    console.log(`[TradeEngine] User balance before: ${user.balance}, Required: ${totalRequired}`);

    // Create trade
    const trade = await Trade.create({
      user: userId,
      clientId,
      tradeSource: 'manual',
      symbol: symbol.toUpperCase(),
      type,
      orderType: 'market',
      amount,
      price: executionPrice,
      leverage,
      stopLoss,
      takeProfit,
      fee,
      margin,
      spread: charges.spreadPips,
      spreadCost,
      commission,
      status: 'open'
    });

    console.log(`[TradeEngine] Trade created: ${trade._id}`);

    // Deduct margin from balance
    const balanceBefore = user.balance;
    user.balance -= totalRequired;
    await user.save();
    
    console.log(`[TradeEngine] Balance deducted. Before: ${balanceBefore}, After: ${user.balance}`);

    // Create transaction record
    await Transaction.create({
      user: userId,
      type: 'margin_deduction',
      amount: -totalRequired,
      description: `Margin for ${type.toUpperCase()} ${amount} ${symbol} @ ${executionPrice}`,
      balanceBefore,
      balanceAfter: user.balance,
      status: 'completed',
      reference: trade._id
    });

    // Notify user
    this.notifyUser(userId, 'orderExecuted', {
      trade,
      message: `${type.toUpperCase()} order executed: ${amount} ${symbol} @ ${executionPrice}`
    });

    return trade;
  }

  /**
   * Execute pending order (limit/stop)
   */
  async executePendingOrder(userId, orderData) {
    const { symbol, type, orderType, amount, price: targetPrice, leverage = 1, stopLoss, takeProfit } = orderData;
    
    const currentPrice = this.getPrice(symbol);
    if (!currentPrice) {
      throw new Error(`Invalid symbol: ${symbol}`);
    }

    // Calculate margin required (reserve it)
    const margin = this.calculateMargin(symbol, amount, targetPrice, leverage);
    const fee = margin * 0.001;
    const totalRequired = margin + fee;

    // Check user balance
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    if (user.balance < totalRequired) {
      throw new Error(`Insufficient balance. Required: $${totalRequired.toFixed(2)}`);
    }

    // Generate client ID
    const clientId = `${user.firstName?.substring(0,2) || 'US'}${user._id.toString().slice(-6)}`.toUpperCase();

    // Create pending trade
    const trade = await Trade.create({
      user: userId,
      clientId,
      tradeSource: 'manual',
      symbol: symbol.toUpperCase(),
      type,
      orderType,
      amount,
      price: targetPrice,
      leverage,
      stopLoss,
      takeProfit,
      fee,
      margin,
      status: 'pending'
    });

    // Reserve margin
    const balanceBefore = user.balance;
    user.balance -= totalRequired;
    await user.save();

    // Create transaction record
    await Transaction.create({
      user: userId,
      type: 'margin_reserved',
      amount: -totalRequired,
      description: `Margin reserved for pending ${orderType} order: ${symbol}`,
      balanceBefore,
      balanceAfter: user.balance,
      status: 'completed',
      reference: trade._id
    });

    // Notify user
    this.notifyUser(userId, 'orderPlaced', {
      trade,
      message: `Pending ${orderType} order placed: ${amount} ${symbol} @ ${targetPrice}`
    });

    return trade;
  }

  /**
   * Check and execute pending orders
   */
  async checkPendingOrders() {
    try {
      const pendingTrades = await Trade.find({ status: 'pending' });
      
      for (const trade of pendingTrades) {
        const price = this.getPrice(trade.symbol);
        if (!price) continue;

        let shouldExecute = false;
        let executionPrice = null;

        if (trade.orderType === 'limit') {
          // Limit buy: execute when ask <= target price
          // Limit sell: execute when bid >= target price
          if (trade.type === 'buy' && price.ask <= trade.price) {
            shouldExecute = true;
            executionPrice = price.ask;
          } else if (trade.type === 'sell' && price.bid >= trade.price) {
            shouldExecute = true;
            executionPrice = price.bid;
          }
        } else if (trade.orderType === 'stop') {
          // Stop buy: execute when ask >= target price
          // Stop sell: execute when bid <= target price
          if (trade.type === 'buy' && price.ask >= trade.price) {
            shouldExecute = true;
            executionPrice = price.ask;
          } else if (trade.type === 'sell' && price.bid <= trade.price) {
            shouldExecute = true;
            executionPrice = price.bid;
          }
        }

        if (shouldExecute) {
          await this.activatePendingOrder(trade, executionPrice);
        }
      }
    } catch (err) {
      console.error('[TradeEngine] Error checking pending orders:', err);
    }
  }

  /**
   * Activate a pending order
   */
  async activatePendingOrder(trade, executionPrice) {
    trade.price = executionPrice;
    trade.status = 'open';
    trade.activatedAt = new Date();
    await trade.save();

    this.notifyUser(trade.user, 'pendingOrderActivated', {
      trade,
      message: `Pending order activated: ${trade.type.toUpperCase()} ${trade.amount} ${trade.symbol} @ ${executionPrice}`
    });

    console.log(`[TradeEngine] Pending order activated: ${trade._id}`);
  }

  /**
   * Check open positions for SL/TP and margin calls
   */
  async checkOpenPositions() {
    // Prevent concurrent checks
    if (this.isCheckingPositions) return;
    this.isCheckingPositions = true;
    
    try {
      const openTrades = await Trade.find({ status: 'open' });
      const userPositions = new Map(); // Group by user for margin check

      for (const trade of openTrades) {
        const price = this.getPrice(trade.symbol);
        if (!price) continue;

        const currentPrice = trade.type === 'buy' ? price.bid : price.ask;
        const pnl = this.calculatePnL(trade, currentPrice);

        // Check Stop Loss - close at SL price when current price hits or crosses it
        if (trade.stopLoss && trade.stopLoss > 0) {
          const slHit = (trade.type === 'buy' && currentPrice <= trade.stopLoss) ||
                       (trade.type === 'sell' && currentPrice >= trade.stopLoss);
          if (slHit) {
            console.log(`[TradeEngine] SL triggered for ${trade.symbol}: Current ${currentPrice}, SL ${trade.stopLoss}`);
            await this.closeTrade(trade, trade.stopLoss, 'stop_loss');
            continue;
          }
        }

        // Check Take Profit - close at TP price when current price hits or crosses it
        if (trade.takeProfit && trade.takeProfit > 0) {
          const tpHit = (trade.type === 'buy' && currentPrice >= trade.takeProfit) ||
                       (trade.type === 'sell' && currentPrice <= trade.takeProfit);
          if (tpHit) {
            console.log(`[TradeEngine] TP triggered for ${trade.symbol}: Current ${currentPrice}, TP ${trade.takeProfit}`);
            await this.closeTrade(trade, trade.takeProfit, 'take_profit');
            continue;
          }
        }

        // Track user positions for margin check
        const userId = trade.user.toString();
        if (!userPositions.has(userId)) {
          userPositions.set(userId, { trades: [], totalPnL: 0, totalMargin: 0 });
        }
        const userPos = userPositions.get(userId);
        userPos.trades.push(trade);
        userPos.totalPnL += pnl;
        userPos.totalMargin += trade.margin || 0;
      }

      // Check margin levels for each user
      for (const [userId, positions] of userPositions) {
        await this.checkMarginLevel(userId, positions);
      }
    } catch (err) {
      console.error('[TradeEngine] Error checking open positions:', err);
    } finally {
      this.isCheckingPositions = false;
    }
  }

  /**
   * Check margin level and trigger stop-out if needed
   */
  async checkMarginLevel(userId, positions) {
    try {
      const user = await User.findById(userId);
      if (!user) return;

      const equity = user.balance + positions.totalPnL;
      const marginLevel = positions.totalMargin > 0 ? (equity / positions.totalMargin) * 100 : 100;

      // Initialize margin call tracking if not exists
      if (!this.marginCallSent) this.marginCallSent = new Map();

      // Margin call at 100% - only send once per user until they recover
      if (marginLevel <= 100 && marginLevel > 50) {
        const lastSent = this.marginCallSent.get(userId.toString());
        const now = Date.now();
        // Only send margin call every 60 seconds per user
        if (!lastSent || (now - lastSent) > 60000) {
          this.marginCallSent.set(userId.toString(), now);
          this.notifyUser(userId, 'marginCall', {
            equity,
            marginLevel: marginLevel.toFixed(2),
            message: `⚠️ MARGIN CALL: Your margin level is ${marginLevel.toFixed(2)}%. Please deposit funds or close positions.`
          });
        }
      } else if (marginLevel > 100) {
        // Clear margin call tracking when recovered
        this.marginCallSent.delete(userId.toString());
      }

      // Stop-out at 50% or equity <= 0
      if (marginLevel <= 50 || equity <= 0) {
        console.log(`[TradeEngine] Stop-out triggered for user ${userId}. Equity: ${equity}, Margin Level: ${marginLevel}%`);
        await this.stopOut(userId, positions.trades, equity, marginLevel);
      }
    } catch (err) {
      console.error('[TradeEngine] Error checking margin level:', err);
    }
  }

  /**
   * Stop-out: Close all positions for a user
   */
  async stopOut(userId, trades, equity, marginLevel) {
    const closedTrades = [];
    let totalPnL = 0;

    for (const trade of trades) {
      const price = this.getPrice(trade.symbol);
      if (!price) continue;

      const closePrice = trade.type === 'buy' ? price.bid : price.ask;
      const result = await this.closeTrade(trade, closePrice, 'stop_out');
      if (result) {
        closedTrades.push(result);
        totalPnL += result.profit;
      }
    }

    // Notify user about stop-out
    this.notifyUser(userId, 'stopOut', {
      closedTrades,
      totalPnL,
      equity,
      marginLevel: marginLevel.toFixed(2),
      message: `🛑 STOP-OUT: All positions closed due to insufficient margin. Total P/L: $${totalPnL.toFixed(2)}`
    });
  }

  /**
   * Close a trade
   */
  async closeTrade(trade, closePrice, reason = 'manual') {
    try {
      // Prevent double closing
      if (trade.status === 'closed') {
        console.log(`[TradeEngine] Trade ${trade._id} already closed, skipping`);
        return trade;
      }
      
      const pnl = this.calculatePnL(trade, closePrice);
      
      console.log(`[TradeEngine] Closing trade ${trade._id}: ${trade.symbol} @ ${closePrice}, PnL: ${pnl.toFixed(2)}, reason: ${reason}`);
      
      trade.closePrice = closePrice;
      trade.profit = pnl;
      trade.status = 'closed';
      trade.closedAt = new Date();
      trade.closeReason = reason;
      await trade.save();

      // Update user balance
      const user = await User.findById(trade.user);
      if (user) {
        const balanceBefore = user.balance;
        const marginReturn = trade.margin || ((trade.amount * trade.price) / trade.leverage);
        user.balance += marginReturn + pnl;
        await user.save();

        // Create transaction record
        await Transaction.create({
          user: trade.user,
          type: pnl >= 0 ? 'trade_profit' : 'trade_loss',
          amount: marginReturn + pnl,
          description: `Closed ${trade.type.toUpperCase()} ${trade.amount} ${trade.symbol} @ ${closePrice} (${reason})`,
          balanceBefore,
          balanceAfter: user.balance,
          status: 'completed',
          reference: trade._id
        });

        // Notify user
        const emoji = pnl >= 0 ? '✅' : '❌';
        this.notifyUser(trade.user, 'tradeClosed', {
          trade,
          reason,
          pnl,
          message: `${emoji} Trade closed (${reason}): ${trade.symbol} P/L: $${pnl.toFixed(2)}`
        });

        // Process IB commission for this trade
        try {
          const IBCommissionEngine = require('./ibCommissionEngine');
          const ibEngine = new IBCommissionEngine(this.io);
          await ibEngine.processTradeCommission(trade, user);
        } catch (ibErr) {
          console.error('[TradeEngine] IB commission error:', ibErr);
        }

        // If this is a master trade (not copied), close follower trades too
        if (!trade.isCopiedTrade && trade.tradeSource !== 'copy') {
          const TradeMaster = require('../models/TradeMaster');
          const tradeMaster = await TradeMaster.findOne({ userId: trade.user, status: 'approved' });
          if (tradeMaster) {
            console.log(`[TradeEngine] Master trade closed - closing follower trades`);
            const CopyTradeEngine = require('./copyTradeEngine');
            const copyEngine = new CopyTradeEngine(this.io);
            // Close follower trades immediately (don't use catch, await it)
            try {
              await copyEngine.closeFollowerTrades(trade, user);
            } catch (err) {
              console.error('[TradeEngine] Error closing follower trades:', err);
            }
          }
        }
      }

      return trade;
    } catch (err) {
      console.error('[TradeEngine] Error closing trade:', err);
      return null;
    }
  }

  /**
   * Calculate P&L for a trade
   */
  calculatePnL(trade, currentPrice) {
    const pipSize = this.getPipSize(trade.symbol);
    const priceDiff = trade.type === 'buy' 
      ? currentPrice - trade.price 
      : trade.price - currentPrice;
    
    // P&L = price difference * amount * contract size * leverage
    let contractSize = 100000; // Standard forex
    if (trade.symbol.includes('XAU')) contractSize = 100;
    else if (trade.symbol.includes('XAG')) contractSize = 5000;
    else if (trade.symbol.includes('BTC') || trade.symbol.includes('ETH')) contractSize = 1;
    
    return priceDiff * trade.amount * contractSize;
  }

  /**
   * Calculate margin required
   */
  calculateMargin(symbol, lotSize, price, leverage) {
    let contractSize = 100000;
    if (symbol.includes('XAU')) contractSize = 100;
    else if (symbol.includes('XAG')) contractSize = 5000;
    else if (symbol.includes('BTC') || symbol.includes('ETH')) contractSize = 1;
    
    return (price * contractSize * lotSize) / leverage;
  }

  /**
   * Get floating P&L for a user
   */
  async getFloatingPnL(userId) {
    const trades = await Trade.find({ user: userId, status: 'open' });
    let totalPnL = 0;
    const positions = [];

    for (const trade of trades) {
      const price = this.getPrice(trade.symbol);
      if (!price) continue;

      const currentPrice = trade.type === 'buy' ? price.bid : price.ask;
      const pnl = this.calculatePnL(trade, currentPrice);
      totalPnL += pnl;

      positions.push({
        ...trade.toObject(),
        currentPrice,
        floatingPnL: pnl
      });
    }

    return { totalPnL, positions };
  }

  /**
   * Modify trade SL/TP
   */
  async modifyTrade(tradeId, userId, { stopLoss, takeProfit }) {
    const trade = await Trade.findOne({ _id: tradeId, user: userId, status: 'open' });
    if (!trade) throw new Error('Trade not found');

    const price = this.getPrice(trade.symbol);
    if (!price) throw new Error('Unable to get current price');

    const currentPrice = trade.type === 'buy' ? price.bid : price.ask;

    // Validate new SL
    if (stopLoss !== undefined) {
      if (stopLoss !== null) {
        if (trade.type === 'buy' && stopLoss >= currentPrice) {
          throw new Error('Stop Loss must be below current price for buy orders');
        }
        if (trade.type === 'sell' && stopLoss <= currentPrice) {
          throw new Error('Stop Loss must be above current price for sell orders');
        }
      }
      trade.stopLoss = stopLoss;
    }

    // Validate new TP
    if (takeProfit !== undefined) {
      if (takeProfit !== null) {
        if (trade.type === 'buy' && takeProfit <= currentPrice) {
          throw new Error('Take Profit must be above current price for buy orders');
        }
        if (trade.type === 'sell' && takeProfit >= currentPrice) {
          throw new Error('Take Profit must be below current price for sell orders');
        }
      }
      trade.takeProfit = takeProfit;
    }

    await trade.save();
    return trade;
  }

  /**
   * Cancel pending order
   */
  async cancelPendingOrder(tradeId, userId) {
    const trade = await Trade.findOne({ _id: tradeId, user: userId, status: 'pending' });
    if (!trade) throw new Error('Pending order not found');

    trade.status = 'cancelled';
    trade.closedAt = new Date();
    await trade.save();

    // Return reserved margin
    const user = await User.findById(userId);
    if (user) {
      const margin = trade.margin || 0;
      const fee = trade.fee || 0;
      const refund = margin + fee;
      
      const balanceBefore = user.balance;
      user.balance += refund;
      await user.save();

      await Transaction.create({
        user: userId,
        type: 'margin_refund',
        amount: refund,
        description: `Margin refunded for cancelled ${trade.orderType} order: ${trade.symbol}`,
        balanceBefore,
        balanceAfter: user.balance,
        status: 'completed',
        reference: trade._id
      });
    }

    this.notifyUser(userId, 'orderCancelled', {
      trade,
      message: `Pending order cancelled: ${trade.symbol}`
    });

    return trade;
  }

  /**
   * Notify user via socket
   */
  notifyUser(userId, event, data) {
    if (this.io) {
      console.log(`[TradeEngine] Emitting ${event} to user ${userId}`);
      
      const socketId = this.userSockets.get(userId.toString());
      if (socketId) {
        this.io.to(socketId).emit(event, data);
      }
      // Also broadcast to user's room
      this.io.to(`user_${userId}`).emit(event, data);
      
      // Broadcast to all clients for real-time updates (positions table refresh)
      this.io.emit(event, { ...data, userId });
    }
  }

  /**
   * Get charges for a trade (from database or defaults)
   */
  async getChargesForTrade(symbol, userId) {
    try {
      const charges = await TradingCharge.getChargesForTrade(symbol, userId);
      return charges;
    } catch (err) {
      console.error('[TradeEngine] Error getting charges:', err);
      // Return default charges
      return {
        spreadPips: this.getDefaultSpread(symbol),
        commissionPerLot: 0,
        swapLong: 0,
        swapShort: 0,
        feePercentage: 0.1,
        minFee: 0,
        maxFee: 0,
        source: 'default'
      };
    }
  }

  /**
   * Calculate spread cost in USD
   */
  calculateSpreadCost(symbol, lotSize, spreadPips) {
    const pipSize = this.getPipSize(symbol);
    
    // Contract size varies by instrument
    let contractSize = 100000; // Standard forex
    if (symbol.includes('XAU')) contractSize = 100;
    else if (symbol.includes('XAG')) contractSize = 5000;
    else if (symbol.includes('BTC') || symbol.includes('ETH')) contractSize = 1;
    
    // Spread cost = spread in pips * pip value * lot size
    const pipValue = contractSize * pipSize;
    return spreadPips * pipValue * lotSize;
  }

  /**
   * Get pip size for symbol
   */
  getPipSize(symbol) {
    const pipSizes = {
      'EURUSD': 0.0001, 'GBPUSD': 0.0001, 'AUDUSD': 0.0001,
      'NZDUSD': 0.0001, 'USDCHF': 0.0001, 'USDCAD': 0.0001,
      'EURGBP': 0.0001, 'EURCHF': 0.0001,
      'USDJPY': 0.01, 'EURJPY': 0.01,
      'XAUUSD': 0.01, 'XAGUSD': 0.001,
      'BTCUSD': 1, 'ETHUSD': 0.01
    };
    return pipSizes[symbol] || 0.0001;
  }

  /**
   * Get default spread for symbol
   */
  getDefaultSpread(symbol) {
    const spreads = {
      'EURUSD': 1, 'GBPUSD': 1.5, 'USDJPY': 1,
      'USDCHF': 1.5, 'AUDUSD': 1.2, 'NZDUSD': 1.5,
      'USDCAD': 1.5, 'EURGBP': 1.5, 'EURJPY': 1.5,
      'EURCHF': 2, 'XAUUSD': 30, 'XAGUSD': 3,
      'BTCUSD': 50, 'ETHUSD': 5
    };
    return spreads[symbol] || 2;
  }
}

// Singleton instance
const tradeEngine = new TradeEngine();

module.exports = tradeEngine;
