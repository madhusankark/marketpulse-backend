const express = require('express');
const router = express.Router();
const Portfolio = require('../models/Portfolio');
const { protect } = require('../middleware/auth');

router.use(protect);

// GET /api/portfolio
router.get('/', async (req, res) => {
  try {
    const portfolio = await Portfolio.findOne({ user: req.user.id }).populate('user', 'name email');
    if (!portfolio) return res.json({ success: true, data: { trades: [], stats: {} } });
    res.json({ success: true, data: portfolio });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/portfolio/trade
router.post('/trade', async (req, res) => {
  try {
    const { symbol, type, quantity, price, notes } = req.body;
    if (!symbol || !type || !quantity || !price) {
      return res.status(400).json({ success: false, message: 'symbol, type, quantity, price required' });
    }
    if (!['buy', 'sell'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type must be buy or sell' });
    }
    let portfolio = await Portfolio.findOne({ user: req.user.id });
    if (!portfolio) {
      portfolio = new Portfolio({ user: req.user.id, trades: [] });
    }
    portfolio.trades.push({
      symbol: symbol.toUpperCase(), type, quantity: Number(quantity),
      price: Number(price), total: Number(quantity) * Number(price), notes
    });
    await portfolio.save();
    res.json({ success: true, data: portfolio });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/portfolio/trade/:tradeId
router.delete('/trade/:tradeId', async (req, res) => {
  try {
    const portfolio = await Portfolio.findOne({ user: req.user.id });
    if (!portfolio) return res.status(404).json({ success: false, message: 'Portfolio not found' });
    portfolio.trades = portfolio.trades.filter(t => t._id.toString() !== req.params.tradeId);
    await portfolio.save();
    res.json({ success: true, data: portfolio });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/portfolio/reset
router.delete('/reset', async (req, res) => {
  try {
    await Portfolio.findOneAndDelete({ user: req.user.id });
    res.json({ success: true, message: 'Portfolio reset' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
