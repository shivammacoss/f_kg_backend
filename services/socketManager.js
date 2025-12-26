const { Server } = require('socket.io');
const MetaApiService = require('./MetaApiService');
const tradeEngine = require('./TradeEngine');

class SocketManager {
  constructor(server, config = {}) {
    // Optimized Socket.IO for low latency
    this.io = new Server(server, {
      cors: {
        origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'http://127.0.0.1:5173'],
        methods: ['GET', 'POST'],
        credentials: true
      },
      // Low latency optimizations
      pingTimeout: 60000,
      pingInterval: 25000,
      transports: ['websocket', 'polling'],
      allowUpgrades: true,
      perMessageDeflate: false // Disable compression for lower latency
    });

    this.config = config;
    this.metaApi = null;
    this.clients = new Map();
    this.prices = {};
    this.lastEmitTime = {};
    this.throttleMs = 50; // Minimum 50ms between emissions per symbol (20 updates/sec max)

    this.setupSocketHandlers();
  }

  /**
   * Initialize MetaApi connection
   */
  async initMetaApi() {
    if (!this.config.metaApiToken || !this.config.metaApiAccountId) {
      console.log('[SocketManager] MetaApi not configured - skipping');
      return false;
    }

    this.metaApi = new MetaApiService(
      this.config.metaApiToken,
      this.config.metaApiAccountId
    );

    this.setupMetaApiHandlers();
    
    const connected = await this.metaApi.connect();
    if (connected) {
      await this.subscribeDefaultSymbols();
    }
    return connected;
  }

  /**
   * Set up MetaApi event handlers
   */
  setupMetaApiHandlers() {
    const self = this;
    let tickCount = 0;
    
    // Stream ticks to clients AND feed to TradeEngine for order execution
    this.metaApi.on('tick', (tickData) => {
      if (tickData && tickData.symbol) {
        // Send to frontend
        self.io.emit('tick', tickData);
        
        // Feed to TradeEngine for order execution
        tradeEngine.updatePrice(tickData.symbol, {
          bid: tickData.bid,
          ask: tickData.ask,
          price: (tickData.bid + tickData.ask) / 2,
          spread: tickData.ask - tickData.bid
        });
        
        // Log first few ticks
        if (tickCount < 5) {
          console.log(`[Socket.IO] Tick: ${tickData.symbol} ${tickData.bid}/${tickData.ask}`);
          tickCount++;
        }
      }
    });

    this.metaApi.on('connected', () => {
      console.log('[SocketManager] MetaApi connected - streaming to clients');
      self.io.emit('provider:connected', { source: 'metaapi' });
    });

    this.metaApi.on('disconnected', () => {
      console.log('[SocketManager] MetaApi disconnected');
      self.io.emit('provider:disconnected', { source: 'metaapi' });
    });

    this.metaApi.on('error', (error) => {
      console.error('[SocketManager] MetaApi error:', error.message);
    });
  }

  /**
   * Handle price update with throttling for optimal performance
   */
  handlePriceUpdate(priceData) {
    const symbol = priceData.symbol;
    const now = Date.now();

    // Store latest price
    this.prices[symbol] = priceData;

    // Throttle emissions to prevent flooding (max 20 updates/sec per symbol)
    const lastEmit = this.lastEmitTime[symbol] || 0;
    if (now - lastEmit >= this.throttleMs) {
      this.lastEmitTime[symbol] = now;

      // Log first few emissions for debugging
      if (!this.loggedSymbols) this.loggedSymbols = new Set();
      if (!this.loggedSymbols.has(symbol)) {
        console.log(`[Socket.IO] Emitting ${symbol}: bid=${priceData.bid}, ask=${priceData.ask}`);
        this.loggedSymbols.add(symbol);
      }

      // Emit to all clients
      this.io.emit('tick', priceData);
      this.io.emit('prices', this.prices);
    }
  }

  /**
   * Subscribe to default trading symbols
   */
  async subscribeDefaultSymbols() {
    const symbols = [
      // Major Forex pairs
      'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
      'AUDUSD', 'NZDUSD', 'USDCAD',
      // Cross pairs
      'EURGBP', 'EURJPY', 'GBPJPY', 'EURCHF',
      'AUDCAD', 'AUDCHF', 'AUDJPY', 'AUDNZD',
      'CADCHF', 'CADJPY', 'CHFJPY',
      'EURAUD', 'EURCAD', 'EURNZD',
      'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPNZD',
      'NZDCAD', 'NZDCHF', 'NZDJPY',
      // Metals
      'XAUUSD', 'XAGUSD', 'XAUEUR',
      // Indices (if available)
      'US30', 'US500', 'US100', 'DE30', 'UK100', 'JP225',
      // Crypto (if available on broker)
      'BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD',
      // Oil & Energy
      'USOIL', 'UKOIL', 'XNGUSD'
    ];

    console.log(`[SocketManager] Subscribing to ${symbols.length} symbols...`);
    await this.metaApi.subscribeSymbols(symbols);
  }

  /**
   * Set up Socket.IO client handlers
   */
  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[Socket.IO] Client connected: ${socket.id}`);
      
      this.clients.set(socket.id, {
        subscribedSymbols: new Set(),
        connectedAt: Date.now()
      });

      // Send current status and prices
      socket.emit('status', this.getStatus());
      socket.emit('prices', this.prices);

      // Handle symbol subscription
      socket.on('subscribe', async (data) => {
        const symbols = Array.isArray(data.symbols) ? data.symbols : [data.symbols];
        console.log(`[Socket.IO] Client ${socket.id} subscribing to:`, symbols);
        
        const client = this.clients.get(socket.id);
        if (client) {
          symbols.forEach(s => client.subscribedSymbols.add(s));
        }

        // Subscribe via MetaApi if connected
        if (this.metaApi && this.metaApi.isConnected) {
          await this.metaApi.subscribeSymbols(symbols);
        }

        socket.emit('subscribed', { symbols });
      });

      // Handle unsubscribe
      socket.on('unsubscribe', (data) => {
        const symbols = Array.isArray(data.symbols) ? data.symbols : [data.symbols];
        const client = this.clients.get(socket.id);
        if (client) {
          symbols.forEach(s => client.subscribedSymbols.delete(s));
        }
        socket.emit('unsubscribed', { symbols });
      });

      // Get current status
      socket.on('getStatus', () => {
        socket.emit('status', this.getStatus());
      });

      // Get all prices
      socket.on('getPrices', () => {
        socket.emit('prices', this.prices);
      });

      // Get specific symbol price
      socket.on('getPrice', (symbol) => {
        socket.emit('price', this.prices[symbol] || null);
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
        this.clients.delete(socket.id);
      });

      socket.on('error', (error) => {
        console.error(`[Socket.IO] Socket error for ${socket.id}:`, error);
      });
    });
  }

  /**
   * Start the socket manager
   */
  async start() {
    console.log('[SocketManager] Starting...');
    
    if (this.config.metaApiToken && this.config.metaApiAccountId) {
      await this.initMetaApi();
    } else {
      console.log('[SocketManager] Socket.IO ready (configure MetaApi in .env)');
    }
  }

  /**
   * Stop and cleanup
   */
  async stop() {
    if (this.metaApi) {
      await this.metaApi.disconnect();
    }
    this.io.close();
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      connected: true,
      metaApiConnected: this.metaApi?.isConnected || false,
      subscribedSymbols: this.metaApi ? Array.from(this.metaApi.subscribedSymbols) : [],
      priceCount: Object.keys(this.prices).length,
      clientCount: this.clients.size,
      source: this.metaApi?.isConnected ? 'metaapi' : 'none'
    };
  }

  /**
   * Get all prices
   */
  getAllPrices() {
    return this.prices;
  }

  /**
   * Get price for symbol
   */
  getPrice(symbol) {
    return this.prices[symbol] || null;
  }

  /**
   * Manually emit price (for external data sources)
   */
  emitPrice(priceData) {
    this.handlePriceUpdate(priceData);
  }
}

module.exports = SocketManager;
