/**
 * MetaApi Service - Real-time market data streaming from MetaTrader via MetaApi.cloud
 * Optimized for low-latency tick-by-tick data delivery
 */

const MetaApi = require('metaapi.cloud-sdk').default;
const EventEmitter = require('events');

class MetaApiService extends EventEmitter {
  constructor(token, accountId) {
    super();
    this.token = token;
    this.accountId = accountId;
    this.api = null;
    this.account = null;
    this.connection = null;
    this.isConnected = false;
    this.subscribedSymbols = new Set();
    this.prices = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  /**
   * Initialize MetaApi connection
   */
  async connect() {
    try {
      console.log('[MetaApi] Initializing connection...');
      
      this.api = new MetaApi(this.token, {
        // Low latency options
        packetOrderingTimeout: 60000,
        enableSocketioDebugger: false
      });

      // Get trading account
      this.account = await this.api.metatraderAccountApi.getAccount(this.accountId);
      
      // Wait for account deployment
      console.log('[MetaApi] Waiting for account deployment...');
      await this.account.waitDeployed();

      // Create streaming connection for real-time data
      this.connection = this.account.getStreamingConnection();
      
      // Set up event listeners before connecting
      this.setupEventListeners();

      // Connect to MetaTrader terminal
      await this.connection.connect();
      
      // Wait for synchronization
      console.log('[MetaApi] Waiting for synchronization...');
      await this.connection.waitSynchronized();

      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('[MetaApi] Connected and synchronized!');
      
      this.emit('connected');
      
      return true;
    } catch (error) {
      console.error('[MetaApi] Connection error:', error.message);
      this.emit('error', error);
      this.scheduleReconnect();
      return false;
    }
  }

  /**
   * Set up real-time event listeners
   */
  setupEventListeners() {
    if (!this.connection) return;

    const self = this;

    // Listen for symbol price updates (tick data)
    this.connection.addSynchronizationListener({
      // Price quote updates - stream directly
      onSymbolPriceUpdated: function(instanceIndex, price) {
        if (price && price.symbol && price.bid !== undefined && price.ask !== undefined) {
          self.emit('tick', {
            symbol: price.symbol,
            bid: parseFloat(price.bid),
            ask: parseFloat(price.ask),
            timestamp: Date.now()
          });
        }
      },
      
      onSymbolPricesUpdated: function(instanceIndex, prices, equity, margin, freeMargin, marginLevel) {
        if (Array.isArray(prices)) {
          prices.forEach(price => {
            if (price && price.symbol && price.bid !== undefined && price.ask !== undefined) {
              self.emit('tick', {
                symbol: price.symbol,
                bid: parseFloat(price.bid),
                ask: parseFloat(price.ask),
                timestamp: Date.now()
              });
            }
          });
        }
      },

      // Tick updates (real-time) - stream directly
      onTicksUpdated: function(instanceIndex, ticks, equity, margin, freeMargin, marginLevel, accountCurrencyExchangeRate) {
        if (Array.isArray(ticks) && ticks.length > 0) {
          ticks.forEach(tick => {
            if (tick.symbol && tick.bid !== undefined && tick.ask !== undefined) {
              self.emit('tick', {
                symbol: tick.symbol,
                bid: parseFloat(tick.bid),
                ask: parseFloat(tick.ask),
                timestamp: Date.now()
              });
            }
          });
        }
      },

      // Connection events
      onConnected: function(instanceIndex, replicas) {
        console.log('[MetaApi] Terminal connected');
        self.isConnected = true;
        self.emit('connected');
      },

      onDisconnected: function(instanceIndex) {
        console.log('[MetaApi] Terminal disconnected');
        self.isConnected = false;
        self.emit('disconnected');
        self.scheduleReconnect();
      },

      onBrokerConnectionStatusChanged: function(instanceIndex, connected) {
        console.log(`[MetaApi] Broker connection: ${connected ? 'connected' : 'disconnected'}`);
      },

      // Required stub methods
      onAccountInformationUpdated: function() {},
      onPositionsReplaced: function() {},
      onPositionUpdated: function() {},
      onPositionRemoved: function() {},
      onOrdersReplaced: function() {},
      onOrderUpdated: function() {},
      onOrderCompleted: function() {},
      onHistoryOrderAdded: function() {},
      onDealAdded: function() {},
      onSymbolSpecificationsUpdated: function() {},
      onSymbolSpecificationUpdated: function() {},
      onSymbolSpecificationRemoved: function() {},
      onSymbolPricesUpdated: function() {},
      onCandlesUpdated: function() {},
      onBooksUpdated: function() {},
      onSubscriptionDowngraded: function() {},
      onStreamClosed: function() {},
      onSynchronizationStarted: function() {
        console.log('[MetaApi] Synchronization started');
      },
      onAccountsSynchronized: function() {},
      onDealsSynchronized: function() {},
      onHistoryOrdersSynchronized: function() {},
      onHealthStatus: function() {},
      onSignalClientUpdated: function() {},
      onUpdateAccountSignalListenerUpdated: function() {},
      onPositionsSynchronized: function() {},
      onPendingOrdersSynchronized: function() {},
      onPendingOrdersReplaced: function() {}
    });
  }

  /**
   * Subscribe to symbol price updates
   */
  async subscribeSymbol(symbol) {
    if (!this.connection || !this.isConnected) {
      console.warn('[MetaApi] Cannot subscribe - not connected');
      return false;
    }

    try {
      await this.connection.subscribeToMarketData(symbol, [
        { type: 'quotes' },
        { type: 'ticks' }
      ]);
      
      this.subscribedSymbols.add(symbol);
      console.log(`[MetaApi] Subscribed to ${symbol}`);
      return true;
    } catch (error) {
      console.error(`[MetaApi] Subscribe error for ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Subscribe to multiple symbols
   */
  async subscribeSymbols(symbols) {
    for (const symbol of symbols) {
      await this.subscribeSymbol(symbol);
    }
    
    // Start polling terminal state for prices (reliable fallback)
    this.startPricePolling();
  }

  /**
   * Poll prices from terminal state and emit to clients
   */
  startPricePolling() {
    const self = this;
    let logCount = 0;

    setInterval(() => {
      if (!self.connection || !self.isConnected) return;

      try {
        const terminalState = self.connection.terminalState;
        
        // Log terminal state structure once
        if (logCount === 0 && terminalState) {
          console.log('[MetaApi] Terminal state keys:', Object.keys(terminalState));
          logCount++;
        }
        
        // Try to get prices from subscribed symbols
        if (terminalState) {
          for (const symbol of self.subscribedSymbols) {
            try {
              const price = terminalState.price(symbol);
              if (price && price.bid !== undefined && price.ask !== undefined) {
                self.emit('tick', {
                  symbol: symbol,
                  bid: price.bid,
                  ask: price.ask,
                  timestamp: Date.now()
                });
                
                if (logCount < 5) {
                  console.log(`[MetaApi] Price ${symbol}: ${price.bid}/${price.ask}`);
                  logCount++;
                }
              }
            } catch (e) {
              // Symbol not available yet
            }
          }
        }
      } catch (e) {
        console.error('[MetaApi] Poll error:', e.message);
      }
    }, 200);
  }

  /**
   * Unsubscribe from symbol
   */
  async unsubscribeSymbol(symbol) {
    if (!this.connection) return;

    try {
      await this.connection.unsubscribeFromMarketData(symbol, [
        { type: 'quotes' },
        { type: 'ticks' }
      ]);
      this.subscribedSymbols.delete(symbol);
      delete this.prices[symbol];
      console.log(`[MetaApi] Unsubscribed from ${symbol}`);
    } catch (error) {
      console.error(`[MetaApi] Unsubscribe error for ${symbol}:`, error.message);
    }
  }

  /**
   * Get current price for symbol
   */
  getPrice(symbol) {
    return this.prices[symbol] || null;
  }

  /**
   * Get all cached prices
   */
  getAllPrices() {
    return { ...this.prices };
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      subscribedSymbols: Array.from(this.subscribedSymbols),
      priceCount: Object.keys(this.prices).length,
      source: 'metaapi'
    };
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[MetaApi] Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[MetaApi] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Disconnect from MetaApi
   */
  async disconnect() {
    try {
      if (this.connection) {
        await this.connection.close();
      }
      this.isConnected = false;
      this.subscribedSymbols.clear();
      this.prices = {};
      console.log('[MetaApi] Disconnected');
    } catch (error) {
      console.error('[MetaApi] Disconnect error:', error.message);
    }
  }
}

module.exports = MetaApiService;
