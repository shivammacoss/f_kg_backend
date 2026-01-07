const express = require('express');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

const { connectDB } = require('./config/db');
const SocketManager = require('./services/socketManager');
const tradeEngine = require('./services/TradeEngine');
const CleanupService = require('./services/cleanupService');

// Import routes
const authRoutes = require('./routes/auth');
const tradeRoutes = require('./routes/trades');
const transactionRoutes = require('./routes/transactions');
const adminRoutes = require('./routes/admin');
const marketRoutes = require('./routes/market');
const walletRoutes = require('./routes/wallet');
const copyTradeRoutes = require('./routes/copyTrade');
const ibRoutes = require('./routes/ib');
const { router: adminAuthRoutes } = require('./routes/adminAuth');
const adminUsersRoutes = require('./routes/adminUsers');
const adminWalletRoutes = require('./routes/adminWallet');
const adminCopyTradeRoutes = require('./routes/adminCopyTrade');
const adminIBRoutes = require('./routes/adminIB');
const supportRoutes = require('./routes/support');
const adminSupportRoutes = require('./routes/adminSupport');
const adminChargesRoutes = require('./routes/adminCharges');
const adminTradesRoutes = require('./routes/adminTrades');
const adminBonusRoutes = require('./routes/adminBonus');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with MetaApi configuration
const socketManager = new SocketManager(server, {
  metaApiToken: process.env.METAAPI_TOKEN,
  metaApiAccountId: process.env.METAAPI_ACCOUNT_ID
});

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging in development
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/copy-trade', copyTradeRoutes);
app.use('/api/ib', ibRoutes);
app.use('/api/support', supportRoutes);
// Admin routes - order matters! More specific routes first
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api/admin/wallet', adminWalletRoutes);
app.use('/api/admin/copy-trade', adminCopyTradeRoutes);
app.use('/api/admin/ib', adminIBRoutes);
app.use('/api/admin/support', adminSupportRoutes);
app.use('/api/admin/charges', adminChargesRoutes);
app.use('/api/admin/trades', adminTradesRoutes);
app.use('/api/admin/bonus', adminBonusRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Forex KG Trading API is running',
    timestamp: new Date().toISOString()
  });
});

// WebSocket status endpoint
app.get('/api/websocket/status', (req, res) => {
  res.json({
    success: true,
    ...socketManager.getStats()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║     Forex KG Trading API Server                 ║
  ║     Running on port ${PORT}                       ║
  ║     Environment: ${process.env.NODE_ENV || 'development'}              ║
  ║     WebSocket: Enabled (Socket.IO)            ║
  ║     Data: MetaApi.cloud (Low Latency)         ║
  ╚═══════════════════════════════════════════════╝
  `);
  
  // Start Socket.IO
  socketManager.start();
  
  // Start Trade Engine
  tradeEngine.setSocketIO(socketManager.io);
  tradeEngine.start();
  
  // Run cleanup on startup (fix orphaned trades)
  CleanupService.runAll();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  socketManager.stop();
  server.close(() => {
    process.exit(0);
  });
});

module.exports = { app, server, socketManager };
