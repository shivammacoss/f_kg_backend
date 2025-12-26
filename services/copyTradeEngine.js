const Trade = require('../models/Trade');
const TradeMaster = require('../models/TradeMaster');
const CopyFollower = require('../models/CopyFollower');
const CopyTradeMap = require('../models/CopyTradeMap');
const CommissionLog = require('../models/CommissionLog');
const User = require('../models/User');
const TradingCharge = require('../models/TradingCharge');
const Transaction = require('../models/Transaction');

class CopyTradeEngine {
  constructor(io) {
    this.io = io;
  }

  // Calculate follower lot size based on copy mode
  calculateFollowerLot(follower, masterLot, masterBalance, followerBalance) {
    let lot = 0;

    switch (follower.copyMode) {
      case 'fixed_lot':
        lot = follower.fixedLot;
        break;
      case 'multiplier':
        lot = masterLot * follower.multiplier;
        break;
      case 'balance_ratio':
        lot = (followerBalance / masterBalance) * masterLot;
        break;
      default:
        lot = follower.fixedLot || 0.01;
    }

    // Apply max lot limit
    lot = Math.min(lot, follower.maxLotSize);
    
    // Round to 2 decimal places
    return Math.round(lot * 100) / 100;
  }

  // Check if follower has sufficient margin
  async checkMargin(userId, symbol, lot, type, tradePrice) {
    const user = await User.findById(userId);
    if (!user) return { valid: false, reason: 'User not found' };

    // Calculate proper margin based on symbol and leverage
    let contractSize = 100000;
    if (symbol.includes('XAU')) contractSize = 100;
    else if (symbol.includes('XAG')) contractSize = 5000;
    else if (symbol.includes('BTC') || symbol.includes('ETH')) contractSize = 1;
    
    const price = tradePrice || 1;
    const requiredMargin = (price * contractSize * lot) / 100; // 1:100 leverage
    const availableMargin = user.balance;

    console.log(`[CopyEngine] Margin check: Required ${requiredMargin.toFixed(2)}, Available ${availableMargin.toFixed(2)}`);

    if (availableMargin < requiredMargin) {
      return { valid: false, reason: `Insufficient margin. Need $${requiredMargin.toFixed(2)}, have $${availableMargin.toFixed(2)}` };
    }

    return { valid: true, requiredMargin };
  }

  // Mirror master trade to all followers
  async mirrorTradeToFollowers(masterTrade, masterUser) {
    const startTime = Date.now();
    const results = [];

    console.log(`[CopyEngine] Starting mirror for trade ${masterTrade._id} by user ${masterUser._id}`);

    try {
      // Get master's TradeMaster profile
      const tradeMaster = await TradeMaster.findOne({ userId: masterUser._id, status: 'approved' });
      if (!tradeMaster) {
        console.log(`[CopyEngine] User ${masterUser._id} is not an approved trade master`);
        // Also check if they have any TradeMaster profile
        const anyProfile = await TradeMaster.findOne({ userId: masterUser._id });
        if (anyProfile) {
          console.log(`[CopyEngine] User has TradeMaster profile with status: ${anyProfile.status}`);
        } else {
          console.log(`[CopyEngine] User has no TradeMaster profile at all`);
        }
        return results;
      }

      console.log(`[CopyEngine] Found TradeMaster: ${tradeMaster._id}, masterId: ${tradeMaster.masterId}`);

      // Get all active followers
      const followers = await CopyFollower.find({
        masterId: tradeMaster._id,
        status: 'active'
      }).populate('userId');

      console.log(`[CopyEngine] Found ${followers.length} active followers for master ${tradeMaster._id}`);

      if (followers.length === 0) {
        // Check if there are any followers at all
        const allFollowers = await CopyFollower.find({ masterId: tradeMaster._id });
        console.log(`[CopyEngine] Total followers (any status): ${allFollowers.length}`);
        allFollowers.forEach(f => console.log(`  - Follower ${f._id}: status=${f.status}`));
        return results;
      }

      console.log(`[CopyEngine] Mirroring trade to ${followers.length} followers`);

      // Process each follower
      for (const follower of followers) {
        try {
          console.log(`[CopyEngine] Processing follower ${follower._id}, userId: ${follower.userId?._id}`);
          
          // Reset daily loss if needed
          follower.resetDailyLoss();

          // Check risk limits
          if (follower.checkRiskLimits()) {
            console.log(`[CopyEngine] Follower ${follower._id} hit risk limits: ${follower.pauseReason}`);
            await follower.save();
            results.push({
              followerId: follower._id,
              success: false,
              reason: follower.pauseReason
            });
            continue;
          }

          // Get follower and master balances
          const followerUser = follower.userId;
          const followerBalance = followerUser?.balance || 0;
          const masterBalance = masterUser.balance || 0;

          console.log(`[CopyEngine] Follower balance: ${followerBalance}, Master balance: ${masterBalance}`);
          console.log(`[CopyEngine] Copy mode: ${follower.copyMode}, Fixed lot: ${follower.fixedLot}`);

          // Calculate lot size
          const followerLot = this.calculateFollowerLot(
            follower,
            masterTrade.lots || masterTrade.amount,
            masterBalance,
            followerBalance
          );

          console.log(`[CopyEngine] Calculated follower lot: ${followerLot}`);

          if (followerLot < 0.01) {
            console.log(`[CopyEngine] Follower lot too small: ${followerLot}`);
            results.push({
              followerId: follower._id,
              success: false,
              reason: 'Calculated lot too small'
            });
            continue;
          }

          // Check margin with price
          const tradePrice = masterTrade.price || masterTrade.entryPrice;
          const marginCheck = await this.checkMargin(
            followerUser._id,
            masterTrade.symbol,
            followerLot,
            masterTrade.type,
            tradePrice
          );

          console.log(`[CopyEngine] Margin check: ${marginCheck.valid ? 'PASSED' : 'FAILED - ' + marginCheck.reason}`);

          if (!marginCheck.valid) {
            results.push({
              followerId: follower._id,
              success: false,
              reason: marginCheck.reason
            });
            
            // Log failed copy
            follower.stats.failedCopies += 1;
            await follower.save();
            continue;
          }

          // Calculate margin for follower (tradePrice already defined above)
          let contractSize = 100000;
          if (masterTrade.symbol.includes('XAU')) contractSize = 100;
          else if (masterTrade.symbol.includes('XAG')) contractSize = 5000;
          else if (masterTrade.symbol.includes('BTC') || masterTrade.symbol.includes('ETH')) contractSize = 1;
          
          const followerMargin = (tradePrice * contractSize * followerLot) / 100; // 1:100 leverage
          
          // Get charges for follower trade (same as master)
          let charges = {
            spreadPips: masterTrade.spread || 2,
            commissionPerLot: 0,
            feePercentage: 0.1,
            minFee: 0,
            maxFee: 0
          };
          
          try {
            const dbCharges = await TradingCharge.getChargesForTrade(masterTrade.symbol, followerUser._id);
            if (dbCharges) charges = dbCharges;
          } catch (e) {
            console.log('[CopyEngine] Using default charges');
          }
          
          // Calculate fees (same as TradeEngine)
          const feePercentage = (charges.feePercentage || 0.1) / 100;
          let fee = followerMargin * feePercentage;
          if (charges.minFee > 0 && fee < charges.minFee) fee = charges.minFee;
          if (charges.maxFee > 0 && fee > charges.maxFee) fee = charges.maxFee;
          
          const commission = (charges.commissionPerLot || 0) * followerLot;
          
          // Calculate spread cost
          const pipSize = masterTrade.symbol.includes('JPY') ? 0.01 : 
                         (masterTrade.symbol.includes('XAU') || masterTrade.symbol.includes('XAG')) ? 0.01 : 0.0001;
          const pipValue = contractSize * pipSize;
          const spreadCost = (charges.spreadPips || 2) * pipValue * followerLot;
          
          const totalRequired = followerMargin + fee + commission + spreadCost;
          
          console.log(`[CopyEngine] Creating follower trade: ${followerLot} lots`);
          console.log(`[CopyEngine] Margin: ${followerMargin.toFixed(2)}, Fee: ${fee.toFixed(2)}, Commission: ${commission.toFixed(2)}, Spread: ${spreadCost.toFixed(2)}`);
          console.log(`[CopyEngine] Total required: ${totalRequired.toFixed(2)}`);

          // Check if follower has enough balance for total
          if (followerUser.balance < totalRequired) {
            console.log(`[CopyEngine] Insufficient balance after charges. Need: ${totalRequired.toFixed(2)}, Have: ${followerUser.balance.toFixed(2)}`);
            results.push({
              followerId: follower._id,
              success: false,
              reason: `Insufficient balance for charges. Need $${totalRequired.toFixed(2)}`
            });
            follower.stats.failedCopies += 1;
            await follower.save();
            continue;
          }

          // Deduct total from follower balance
          const balanceBefore = followerUser.balance;
          followerUser.balance -= totalRequired;
          await followerUser.save();
          
          console.log(`[CopyEngine] Follower balance: ${balanceBefore.toFixed(2)} -> ${followerUser.balance.toFixed(2)}`);

          // Create follower trade with all charges
          const followerTrade = await Trade.create({
            user: followerUser._id,
            symbol: masterTrade.symbol,
            type: masterTrade.type,
            orderType: 'market',
            amount: followerLot,
            price: tradePrice,
            leverage: 100,
            margin: followerMargin,
            fee: fee,
            commission: commission,
            spread: charges.spreadPips || 2,
            spreadCost: spreadCost,
            stopLoss: masterTrade.stopLoss,
            takeProfit: masterTrade.takeProfit,
            status: 'open',
            isCopiedTrade: true,
            masterTradeId: masterTrade._id,
            tradeSource: 'copied',
            clientId: `CP${followerUser._id.toString().slice(-6)}`.toUpperCase()
          });
          
          // Create transaction record for follower
          await Transaction.create({
            user: followerUser._id,
            type: 'margin_deduction',
            amount: -totalRequired,
            description: `Copied trade: ${masterTrade.type.toUpperCase()} ${followerLot} ${masterTrade.symbol} @ ${tradePrice}`,
            balanceBefore: balanceBefore,
            balanceAfter: followerUser.balance,
            status: 'completed',
            reference: followerTrade._id
          });
          
          console.log(`[CopyEngine] Follower trade created: ${followerTrade._id}`);

          // Create copy trade map
          const copyMap = await CopyTradeMap.create({
            masterTradeId: masterTrade._id,
            masterId: tradeMaster._id,
            masterUserId: masterUser._id,
            followerTradeId: followerTrade._id,
            followerId: follower._id,
            followerUserId: followerUser._id,
            symbol: masterTrade.symbol,
            type: masterTrade.type,
            masterLot: masterTrade.amount,
            followerLot: followerLot,
            copyMode: follower.copyMode,
            entryPrice: tradePrice,
            executionDelay: Date.now() - startTime
          });

          // Update follower stats
          follower.stats.totalCopiedTrades += 1;
          follower.stats.successfulCopies += 1;
          await follower.save();

          // Emit to follower
          if (this.io) {
            this.io.to(`user_${followerUser._id}`).emit('trade_copied', {
              trade: followerTrade,
              masterTrade: masterTrade.symbol
            });
          }

          results.push({
            followerId: follower._id,
            success: true,
            followerTradeId: followerTrade._id,
            lot: followerLot
          });

        } catch (err) {
          console.error(`[CopyEngine] Error copying to follower ${follower._id}:`, err);
          results.push({
            followerId: follower._id,
            success: false,
            reason: err.message
          });
        }
      }

      // Update master stats
      tradeMaster.stats.totalTrades += 1;
      await tradeMaster.save();

    } catch (error) {
      console.error('[CopyEngine] Mirror trade error:', error);
    }

    return results;
  }

  // Propagate SL/TP changes to followers
  async propagateModification(masterTrade) {
    try {
      const copyMaps = await CopyTradeMap.find({
        masterTradeId: masterTrade._id,
        status: 'open'
      });

      for (const map of copyMaps) {
        await Trade.findByIdAndUpdate(map.followerTradeId, {
          stopLoss: masterTrade.stopLoss,
          takeProfit: masterTrade.takeProfit
        });

        // Emit update to follower
        if (this.io) {
          this.io.to(`user_${map.followerUserId}`).emit('trade_modified', {
            tradeId: map.followerTradeId,
            stopLoss: masterTrade.stopLoss,
            takeProfit: masterTrade.takeProfit
          });
        }
      }

      console.log(`[CopyEngine] Propagated modification to ${copyMaps.length} followers`);
    } catch (error) {
      console.error('[CopyEngine] Propagate modification error:', error);
    }
  }

  // Close all follower trades when master closes
  async closeFollowerTrades(masterTrade, masterUser) {
    try {
      const masterUserId = masterUser._id || masterUser;
      console.log(`[CopyEngine] Closing follower trades for master trade ${masterTrade._id}, masterUser: ${masterUserId}`);
      
      const tradeMaster = await TradeMaster.findOne({ userId: masterUserId });
      if (!tradeMaster) {
        console.log(`[CopyEngine] No trade master found for user ${masterUserId}`);
        return;
      }
      
      console.log(`[CopyEngine] Found TradeMaster: ${tradeMaster._id}`);

      // Find all copy maps for this master trade
      const copyMaps = await CopyTradeMap.find({
        masterTradeId: masterTrade._id,
        status: 'open'
      });

      console.log(`[CopyEngine] Found ${copyMaps.length} follower trades to close for masterTradeId: ${masterTrade._id}`);

      for (const map of copyMaps) {
        try {
          // Get follower trade
          const followerTrade = await Trade.findById(map.followerTradeId);
          if (!followerTrade || followerTrade.status === 'closed') {
            console.log(`[CopyEngine] Follower trade ${map.followerTradeId} not found or already closed`);
            continue;
          }

          // Get close price from master trade
          const closePrice = masterTrade.closePrice || masterTrade.exitPrice;
          
          // Calculate PnL for follower trade
          const entryPrice = followerTrade.price;
          const priceDiff = followerTrade.type === 'buy' 
            ? closePrice - entryPrice 
            : entryPrice - closePrice;
          
          // Contract size varies by symbol
          let contractSize = 100000;
          if (followerTrade.symbol.includes('XAU')) contractSize = 100;
          else if (followerTrade.symbol.includes('XAG')) contractSize = 5000;
          else if (followerTrade.symbol.includes('BTC') || followerTrade.symbol.includes('ETH')) contractSize = 1;
          
          const pnl = priceDiff * followerTrade.amount * contractSize;
          
          console.log(`[CopyEngine] Follower trade PnL: ${pnl.toFixed(2)} (Entry: ${entryPrice}, Close: ${closePrice})`);

          // Update follower trade
          followerTrade.status = 'closed';
          followerTrade.closePrice = closePrice;
          followerTrade.closedAt = new Date();
          followerTrade.profit = pnl;
          followerTrade.closeReason = 'master_closed';
          await followerTrade.save();

          // Update copy map
          map.status = 'closed';
          map.closedAt = new Date();
          map.masterPnL = masterTrade.profit || 0;
          map.followerPnL = pnl;
          map.exitPrice = closePrice;
          await map.save();

          // Return margin + PnL to follower balance
          const followerUser = await User.findById(map.followerUserId);
          if (followerUser) {
            const marginReturn = followerTrade.margin || 0;
            const totalReturn = marginReturn + pnl;
            
            const balanceBefore = followerUser.balance;
            followerUser.balance += totalReturn;
            await followerUser.save();
            
            console.log(`[CopyEngine] Follower balance: ${balanceBefore.toFixed(2)} + ${totalReturn.toFixed(2)} = ${followerUser.balance.toFixed(2)}`);
            
            // Create transaction record
            await Transaction.create({
              user: followerUser._id,
              type: 'trade_close',
              amount: totalReturn,
              description: `Closed copied trade: ${followerTrade.type.toUpperCase()} ${followerTrade.amount} ${followerTrade.symbol} | PnL: $${pnl.toFixed(2)}`,
              balanceBefore: balanceBefore,
              balanceAfter: followerUser.balance,
              status: 'completed',
              reference: followerTrade._id
            });
          }

          // Process copy trade commission (to master)
          await this.processCommission(map, tradeMaster, pnl);

          // Process IB commission for follower's trade
          try {
            const IBCommissionEngine = require('./ibCommissionEngine');
            const ibEngine = new IBCommissionEngine(this.io);
            await ibEngine.processTradeCommission(followerTrade, followerUser);
          } catch (ibErr) {
            console.error('[CopyEngine] IB commission error:', ibErr);
          }

          // Update follower stats
          const follower = await CopyFollower.findById(map.followerId);
          if (follower) {
            follower.stats.totalPnL += pnl;
            if (pnl < 0) {
              follower.stats.dailyLoss += Math.abs(pnl);
            }
            await follower.save();
          }

          // Emit close event
          if (this.io) {
            this.io.to(`user_${map.followerUserId}`).emit('trade_closed', {
              tradeId: map.followerTradeId,
              pnl: pnl,
              marginReturn: followerTrade.margin || 0
            });
          }
          
          // Dispatch event for frontend
          if (this.io) {
            this.io.to(`user_${map.followerUserId}`).emit('balanceUpdate', {});
          }

        } catch (err) {
          console.error(`[CopyEngine] Error closing follower trade ${map.followerTradeId}:`, err);
        }
      }

      // Update master stats
      if (masterTrade.profit > 0) {
        tradeMaster.stats.winningTrades += 1;
      } else {
        tradeMaster.stats.losingTrades += 1;
      }
      tradeMaster.stats.totalPnL += masterTrade.profit || 0;
      if (tradeMaster.updateStats) tradeMaster.updateStats();
      await tradeMaster.save();

      console.log(`[CopyEngine] Successfully closed ${copyMaps.length} follower trades`);
    } catch (error) {
      console.error('[CopyEngine] Close follower trades error:', error);
    }
  }

  // Calculate PnL for a trade
  calculatePnL(trade) {
    if (!trade.exitPrice || !trade.entryPrice) return 0;
    
    const priceDiff = trade.type === 'buy' 
      ? trade.exitPrice - trade.entryPrice
      : trade.entryPrice - trade.exitPrice;
    
    // Simplified PnL calculation - adjust based on pip value in production
    const pnl = priceDiff * (trade.lots || trade.amount) * 100000 * 0.0001;
    return Math.round(pnl * 100) / 100;
  }

  // Process commission for a closed trade
  async processCommission(copyMap, tradeMaster, followerPnL) {
    try {
      let commissionAmount = 0;

      switch (tradeMaster.commissionType) {
        case 'profit_share':
          // Only charge commission on profit
          if (followerPnL > 0) {
            commissionAmount = followerPnL * (tradeMaster.commissionValue / 100);
          }
          break;
        case 'per_lot':
          commissionAmount = copyMap.followerLot * tradeMaster.commissionValue;
          break;
        case 'subscription':
          // Handled separately via monthly billing
          return;
      }

      if (commissionAmount <= 0) return;

      // Create commission log
      const commission = await CommissionLog.create({
        masterId: tradeMaster._id,
        masterUserId: tradeMaster.userId,
        followerUserId: copyMap.followerUserId,
        copyTradeMapId: copyMap._id,
        masterTradeId: copyMap.masterTradeId,
        followerTradeId: copyMap.followerTradeId,
        commissionType: tradeMaster.commissionType,
        tradePnL: followerPnL,
        lotSize: copyMap.followerLot,
        commissionRate: tradeMaster.commissionValue,
        commissionAmount: commissionAmount,
        description: `Commission for ${copyMap.symbol} trade`
      });

      // Deduct from follower
      await User.findByIdAndUpdate(copyMap.followerUserId, {
        $inc: { balance: -commissionAmount }
      });

      // Credit to master
      tradeMaster.stats.totalCommissionEarned += commissionAmount;
      tradeMaster.stats.availableCommission += commissionAmount;
      await tradeMaster.save();

      // Update commission status
      commission.status = 'paid';
      commission.paidAt = new Date();
      await commission.save();

      // Update copy map
      copyMap.commissionAmount = commissionAmount;
      copyMap.commissionPaid = true;
      await copyMap.save();

      // Update follower stats
      const follower = await CopyFollower.findById(copyMap.followerId);
      if (follower) {
        follower.stats.totalCommissionPaid += commissionAmount;
        await follower.save();
      }

      console.log(`[CopyEngine] Processed commission: $${commissionAmount}`);
    } catch (error) {
      console.error('[CopyEngine] Process commission error:', error);
    }
  }
}

module.exports = CopyTradeEngine;
