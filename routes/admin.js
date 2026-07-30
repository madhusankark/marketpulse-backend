const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Alert = require('../models/Alert');
const AlertHistory = require('../models/AlertHistory');
const Notification = require('../models/Notification');
const SystemLog = require('../models/SystemLog');
const Stock = require('../models/Stock');
const { protect, authorize } = require('../middleware/auth');
const MarketDataService = require('../services/marketDataService');
const { redis } = require('../config/db');
const os = require('os');

router.use(protect);
router.use(authorize('admin'));

// GET /api/admin/health
router.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    success: true,
    data: {
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB'
      },
      platform: os.platform(),
      nodeVersion: process.version,
      redis: redis.status === 'ready' ? 'connected' : 'disconnected',
      preOpenCacheAge: 'N/A',
      preOpenCacheSize: 0
    }
  });
});

// GET /api/admin/market-overview
router.get('/market-overview', async (req, res) => {
  try {
    const [quotes, indices] = await Promise.all([
      MarketDataService.getAllQuotes().catch(() => []),
      MarketDataService.getMarketIndices().catch(() => [])
    ]);

    const gainers = quotes.filter(s => s.changePercent > 0).length;
    const losers = quotes.filter(s => s.changePercent < 0).length;
    const unchanged = quotes.filter(s => s.changePercent === 0).length;

    res.json({
      success: true,
      data: {
        totalStocksTracked: quotes.length,
        gainersToday: gainers,
        losersToday: losers,
        unchanged,
        topIndices: indices.slice(0, 5),
        lastUpdated: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      totalAlerts,
      activeAlerts,
      triggeredAlertsToday,
      totalStocks,
      recentLogs
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      Alert.countDocuments(),
      Alert.countDocuments({ isActive: true }),
      AlertHistory.countDocuments({
        triggeredAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
      }),
      Stock.countDocuments(),
      SystemLog.find().sort({ timestamp: -1 }).limit(10)
    ]);

    const notificationsSent = await Notification.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });

    res.json({
      success: true,
      data: {
        users: { total: totalUsers, active: activeUsers },
        alerts: { total: totalAlerts, active: activeAlerts, triggeredToday: triggeredAlertsToday },
        stocks: { total: totalStocks },
        notificationsSent,
        recentLogs
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      User.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: { users, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/users/:id/status
router.put('/users/:id/status', async (req, res) => {
  try {
    const { isActive } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/logs
router.get('/logs', async (req, res) => {
  try {
    const { page = 1, limit = 50, level, action } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    if (level) query.level = level;
    if (action) query.action = action;

    const [logs, total] = await Promise.all([
      SystemLog.find(query).sort({ timestamp: -1 }).skip(skip).limit(parseInt(limit)).populate('user', 'name email'),
      SystemLog.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: { logs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [userStats, alertStats, logStats] = await Promise.all([
      User.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } }
      ]),
      Alert.aggregate([
        { $group: { _id: { isActive: '$isActive' }, count: { $sum: 1 } } }
      ]),
      SystemLog.aggregate([
        { $group: { _id: '$level', count: { $sum: 1 } } }
      ])
    ]);

    res.json({
      success: true,
      data: { userStats, alertStats, logStats }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
