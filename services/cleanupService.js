/**
 * Cleanup Service - Fixes orphaned trades and data inconsistencies
 */

const Trade = require('../models/Trade');
const CopyTradeMap = require('../models/CopyTradeMap');
const User = require('../models/User');

class CleanupService {
  /**
   * Close orphaned follower trades (master closed but follower still open)
   */
  static async closeOrphanedFollowerTrades() {
    try {
      const openMaps = await CopyTradeMap.find({ status: 'open' });
      console.log(`[Cleanup] Checking ${openMaps.length} open CopyTradeMaps...`);
      
      let fixed = 0;
      for (const map of openMaps) {
        try {
          const masterTrade = await Trade.findById(map.masterTradeId);
          if (!masterTrade || masterTrade.status !== 'closed') continue;
          
          const followerTrade = await Trade.findById(map.followerTradeId);
          if (!followerTrade || followerTrade.status === 'closed') {
            map.status = 'closed';
            await map.save();
            continue;
          }
          
          // Calculate PnL
          const closePrice = masterTrade.closePrice;
          const entryPrice = followerTrade.price;
          const priceDiff = followerTrade.type === 'buy' 
            ? closePrice - entryPrice 
            : entryPrice - closePrice;
          
          let contractSize = 100000;
          if (followerTrade.symbol.includes('XAU')) contractSize = 100;
          else if (followerTrade.symbol.includes('XAG')) contractSize = 5000;
          else if (followerTrade.symbol.includes('BTC') || followerTrade.symbol.includes('ETH')) contractSize = 1;
          
          const pnl = priceDiff * followerTrade.amount * contractSize;
          
          // Close follower trade
          followerTrade.status = 'closed';
          followerTrade.closePrice = closePrice;
          followerTrade.closedAt = new Date();
          followerTrade.profit = pnl;
          followerTrade.closeReason = 'master_closed';
          await followerTrade.save();
          
          // Update map
          map.status = 'closed';
          map.closedAt = new Date();
          map.followerPnL = pnl;
          map.exitPrice = closePrice;
          await map.save();
          
          // Return margin + PnL to follower
          const followerUser = await User.findById(map.followerUserId);
          if (followerUser) {
            const marginReturn = followerTrade.margin || 0;
            const totalReturn = marginReturn + pnl;
            followerUser.balance += totalReturn;
            await followerUser.save();
            console.log(`[Cleanup] Fixed orphaned trade ${followerTrade._id}: PnL $${pnl.toFixed(2)}`);
          }
          fixed++;
        } catch (e) {
          // Skip errors
        }
      }
      
      if (fixed > 0) {
        console.log(`[Cleanup] Fixed ${fixed} orphaned follower trades`);
      }
      return fixed;
    } catch (err) {
      console.error('[Cleanup] Error:', err.message);
      return 0;
    }
  }

  /**
   * Run all cleanup tasks
   */
  static async runAll() {
    console.log('[Cleanup] Running startup cleanup...');
    await this.closeOrphanedFollowerTrades();
    console.log('[Cleanup] Startup cleanup complete');
  }
}

module.exports = CleanupService;
