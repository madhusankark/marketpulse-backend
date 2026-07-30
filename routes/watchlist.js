const express = require('express');
const router = express.Router();
const Watchlist = require('../models/Watchlist');
const MarketDataService = require('../services/marketDataService');
const { protect } = require('../middleware/auth');

// GET /api/watchlists
router.get('/', protect, async (req, res) => {
  try {
    const watchlists = await Watchlist.find({ user: req.user._id })
      .sort({ isDefault: -1, createdAt: -1 });

    const enriched = await Promise.all(watchlists.map(async (wl) => {
      const stocksWithQuotes = await Promise.all(
        wl.stocks.map(async (item) => {
          const quote = await MarketDataService.getLiveQuote(item.symbol);
          return { ...item.toObject(), quote };
        })
      );
      return { ...wl.toObject(), stocks: stocksWithQuotes };
    }));

    res.json({ success: true, data: enriched });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/watchlists
router.post('/', protect, async (req, res) => {
  try {
    const { name, description } = req.body;

    const existing = await Watchlist.findOne({ user: req.user._id, name });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Watchlist with this name already exists' });
    }

    const watchlistCount = await Watchlist.countDocuments({ user: req.user._id });

    const watchlist = await Watchlist.create({
      user: req.user._id,
      name,
      description,
      isDefault: watchlistCount === 0
    });

    res.status(201).json({ success: true, data: watchlist });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/watchlists/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const watchlist = await Watchlist.findOne({ _id: req.params.id, user: req.user._id });

    if (!watchlist) {
      return res.status(404).json({ success: false, message: 'Watchlist not found' });
    }

    const stocksWithQuotes = await Promise.all(
      watchlist.stocks.map(async (item) => {
        const quote = await MarketDataService.getLiveQuote(item.symbol);
        return { ...item.toObject(), quote };
      })
    );

    res.json({ success: true, data: { ...watchlist.toObject(), stocks: stocksWithQuotes } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/watchlists/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const { name, description } = req.body;
    const watchlist = await Watchlist.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { name, description },
      { new: true, runValidators: true }
    );

    if (!watchlist) {
      return res.status(404).json({ success: false, message: 'Watchlist not found' });
    }

    res.json({ success: true, data: watchlist });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/watchlists/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const watchlist = await Watchlist.findOneAndDelete({ _id: req.params.id, user: req.user._id });

    if (!watchlist) {
      return res.status(404).json({ success: false, message: 'Watchlist not found' });
    }

    res.json({ success: true, message: 'Watchlist deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/watchlists/:id/stocks
router.post('/:id/stocks', protect, async (req, res) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({ success: false, message: 'Symbol is required' });
    }

    const watchlist = await Watchlist.findOne({ _id: req.params.id, user: req.user._id });
    if (!watchlist) {
      return res.status(404).json({ success: false, message: 'Watchlist not found' });
    }

    const alreadyExists = watchlist.stocks.some(
      s => s.symbol.toUpperCase() === symbol.toUpperCase()
    );

    if (alreadyExists) {
      return res.status(400).json({ success: false, message: 'Stock already in watchlist' });
    }

    watchlist.stocks.push({ symbol: symbol.toUpperCase() });
    await watchlist.save();

    res.json({ success: true, data: watchlist });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/watchlists/:id/stocks/:symbol
router.delete('/:id/stocks/:symbol', protect, async (req, res) => {
  try {
    const watchlist = await Watchlist.findOne({ _id: req.params.id, user: req.user._id });
    if (!watchlist) {
      return res.status(404).json({ success: false, message: 'Watchlist not found' });
    }

    watchlist.stocks = watchlist.stocks.filter(
      s => s.symbol.toUpperCase() !== req.params.symbol.toUpperCase()
    );
    await watchlist.save();

    res.json({ success: true, data: watchlist });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
