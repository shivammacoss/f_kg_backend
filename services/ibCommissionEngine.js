const IB = require('../models/IB');
const IBReferral = require('../models/IBReferral');
const IBCommissionLog = require('../models/IBCommissionLog');

class IBCommissionEngine {
  constructor(io) {
    this.io = io;
  }

  // Calculate and credit commission when a trade closes
  async processTradeCommission(trade, user) {
    try {
      // Find if this user was referred by an IB
      const referral = await IBReferral.findOne({ 
        referredUserId: user._id,
        status: 'active'
      }).populate('ibId');

      if (!referral || !referral.ibId) {
        return null; // User not referred by any IB
      }

      const ib = referral.ibId;

      // Check if IB is active and commission not frozen
      if (ib.status !== 'active' || ib.commissionFrozen) {
        console.log(`[IBEngine] IB ${ib.ibId} is inactive or frozen`);
        return null;
      }

      // Calculate commission based on IB's commission type
      let commission = 0;
      const lots = trade.lots || trade.amount || 0;

      switch (ib.commissionType) {
        case 'per_lot':
          commission = lots * ib.commissionValue;
          break;
        case 'percentage_spread':
          // Assuming spread is stored in trade
          const spread = trade.spread || 0;
          commission = (spread * lots * 100000 * 0.0001) * (ib.commissionValue / 100);
          break;
        case 'percentage_profit':
          if (trade.profit > 0) {
            commission = trade.profit * (ib.commissionValue / 100);
          }
          break;
        default:
          commission = lots * ib.commissionValue;
      }

      if (commission <= 0) {
        return null;
      }

      // Round to 2 decimal places
      commission = Math.round(commission * 100) / 100;

      // Create commission log
      const commissionLog = await IBCommissionLog.create({
        ibId: ib._id,
        ibUserId: ib.userId,
        sourceUserId: user._id,
        sourceType: 'trade',
        tradeId: trade._id,
        symbol: trade.symbol,
        lots: lots,
        commissionType: ib.commissionType,
        commissionRate: ib.commissionValue,
        commissionAmount: commission,
        status: 'credited',
        description: `Commission for ${trade.symbol} trade (${lots} lots)`
      });

      // Credit IB wallet
      ib.wallet.balance += commission;
      ib.wallet.totalEarned += commission;
      ib.stats.totalTradingVolume += lots;
      await ib.save();

      // Update referral stats
      referral.stats.totalTradingVolume += lots;
      referral.stats.totalTrades += 1;
      referral.stats.commissionGenerated += commission;
      referral.lastActivityAt = new Date();
      await referral.save();

      // Emit notification to IB
      if (this.io) {
        this.io.to(`user_${ib.userId}`).emit('ib_commission', {
          amount: commission,
          source: trade.symbol,
          type: 'trade'
        });
      }

      console.log(`[IBEngine] Credited $${commission} to IB ${ib.ibId} for trade`);
      return commissionLog;

    } catch (error) {
      console.error('[IBEngine] Process trade commission error:', error);
      return null;
    }
  }

  // Process first deposit commission
  async processFirstDepositCommission(transaction, user) {
    try {
      // Find if this user was referred by an IB
      const referral = await IBReferral.findOne({ 
        referredUserId: user._id,
        status: 'active'
      }).populate('ibId');

      if (!referral || !referral.ibId) {
        return null;
      }

      // Check if first deposit already processed
      if (referral.firstDepositProcessed) {
        return null;
      }

      const ib = referral.ibId;

      // Check if IB has first deposit commission enabled
      if (!ib.firstDepositCommission?.enabled) {
        return null;
      }

      // Check if IB is active and commission not frozen
      if (ib.status !== 'active' || ib.commissionFrozen) {
        return null;
      }

      const depositAmount = transaction.amount;
      const commissionPercent = ib.firstDepositCommission.percentage || 10;
      let commission = depositAmount * (commissionPercent / 100);

      // Round to 2 decimal places
      commission = Math.round(commission * 100) / 100;

      if (commission <= 0) {
        return null;
      }

      // Create commission log
      const commissionLog = await IBCommissionLog.create({
        ibId: ib._id,
        ibUserId: ib.userId,
        sourceUserId: user._id,
        sourceType: 'first_deposit',
        transactionId: transaction._id,
        depositAmount: depositAmount,
        commissionType: 'first_deposit',
        commissionRate: commissionPercent,
        commissionAmount: commission,
        status: 'credited',
        description: `First deposit commission ($${depositAmount})`
      });

      // Credit IB wallet
      ib.wallet.balance += commission;
      ib.wallet.totalEarned += commission;
      ib.stats.totalDeposits += depositAmount;
      await ib.save();

      // Mark first deposit as processed
      referral.firstDepositProcessed = true;
      referral.firstDepositDate = new Date();
      referral.stats.firstDeposit = depositAmount;
      referral.stats.totalDeposits += depositAmount;
      referral.stats.commissionGenerated += commission;
      await referral.save();

      // Emit notification to IB
      if (this.io) {
        this.io.to(`user_${ib.userId}`).emit('ib_commission', {
          amount: commission,
          source: 'First Deposit',
          type: 'first_deposit'
        });
      }

      console.log(`[IBEngine] Credited $${commission} to IB ${ib.ibId} for first deposit`);
      return commissionLog;

    } catch (error) {
      console.error('[IBEngine] Process first deposit commission error:', error);
      return null;
    }
  }

  // Process regular deposit (update stats only, no commission)
  async processDeposit(transaction, user) {
    try {
      const referral = await IBReferral.findOne({ 
        referredUserId: user._id,
        status: 'active'
      }).populate('ibId');

      if (!referral || !referral.ibId) {
        return;
      }

      const ib = referral.ibId;

      // Update referral stats
      referral.stats.totalDeposits += transaction.amount;
      referral.lastActivityAt = new Date();
      await referral.save();

      // Update IB stats
      ib.stats.totalDeposits += transaction.amount;
      await ib.save();

    } catch (error) {
      console.error('[IBEngine] Process deposit error:', error);
    }
  }

  // Register new referral when user signs up with referral code
  async registerReferral(newUser, referralCode) {
    try {
      // Find IB by referral code or IB ID
      const ib = await IB.findOne({
        $or: [
          { referralCode: referralCode },
          { ibId: referralCode }
        ],
        status: 'active'
      });

      if (!ib) {
        console.log(`[IBEngine] Invalid referral code: ${referralCode}`);
        return null;
      }

      // Prevent self-referral
      if (ib.userId.toString() === newUser._id.toString()) {
        console.log(`[IBEngine] Self-referral blocked`);
        return null;
      }

      // Check if user already has a referral
      const existingReferral = await IBReferral.findOne({ referredUserId: newUser._id });
      if (existingReferral) {
        console.log(`[IBEngine] User already has a referral`);
        return null;
      }

      // Create referral
      const referral = await IBReferral.create({
        ibId: ib._id,
        ibUserId: ib.userId,
        referredUserId: newUser._id,
        referralCode: ib.referralCode
      });

      // Update IB stats
      ib.stats.totalReferrals += 1;
      ib.stats.activeReferrals += 1;
      await ib.save();

      // Update user with IB reference
      newUser.referredBy = ib._id;
      newUser.referralCode = ib.referralCode;
      await newUser.save();

      console.log(`[IBEngine] Registered referral: ${newUser.email} → IB ${ib.ibId}`);
      return referral;

    } catch (error) {
      console.error('[IBEngine] Register referral error:', error);
      return null;
    }
  }
}

module.exports = IBCommissionEngine;
