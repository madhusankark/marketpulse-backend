const express = require('express');
const router = express.Router();
const MarketDataService = require('../services/marketDataService');
const { protect } = require('../middleware/auth');

// GET /api/stocks/search?q=reliance
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    const stocks = await MarketDataService.searchStocks(q, parseInt(limit));
    res.json({ success: true, data: stocks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/quote/:symbol
router.get('/quote/:symbol', async (req, res) => {
  try {
    const quote = await MarketDataService.getLiveQuote(req.params.symbol);
    if (!quote) {
      return res.status(404).json({ success: false, message: 'Stock not found' });
    }
    res.json({ success: true, data: quote });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/quotes - all live quotes
router.get('/quotes', async (req, res) => {
  try {
    const quotes = await MarketDataService.getAllQuotes();
    res.json({ success: true, data: quotes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/details/:symbol
router.get('/details/:symbol', async (req, res) => {
  try {
    const details = await MarketDataService.getStockDetails(req.params.symbol);
    if (!details) {
      return res.status(404).json({ success: false, message: 'Stock not found' });
    }
    res.json({ success: true, data: details });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/intraday/:symbol
router.get('/intraday/:symbol', async (req, res) => {
  try {
    const prices = await MarketDataService.getIntradayPrices(req.params.symbol);
    res.json({ success: true, data: prices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/history/:symbol?days=90
router.get('/history/:symbol', async (req, res) => {
  try {
    const { days = 90, interval = '1day' } = req.query;
    const prices = await MarketDataService.getHistoricalPrices(req.params.symbol, parseInt(days), interval);
    res.json({ success: true, data: prices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/gainers
router.get('/gainers', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const gainers = await MarketDataService.getTopGainers(parseInt(limit));
    res.json({ success: true, data: gainers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/losers
router.get('/losers', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const losers = await MarketDataService.getTopLosers(parseInt(limit));
    res.json({ success: true, data: losers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/most-active
router.get('/most-active', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const active = await MarketDataService.getMostActive(parseInt(limit));
    res.json({ success: true, data: active });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/52week-highlow
router.get('/52week-highlow', async (req, res) => {
  try {
    const data = await MarketDataService.get52WeekHighLow();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/indices
router.get('/indices', async (req, res) => {
  try {
    const indices = await MarketDataService.getMarketIndices();
    res.json({ success: true, data: indices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/sectors
router.get('/sectors', async (req, res) => {
  try {
    const sectors = await MarketDataService.getSectorPerformance();
    res.json({ success: true, data: sectors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/sector-names
router.get('/sector-names', async (req, res) => {
  try {
    const names = await MarketDataService.getAllSectors();
    res.json({ success: true, data: names });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/category/:type
router.get('/category/:type', async (req, res) => {
  try {
    const stocks = await MarketDataService.getCategoryStocks(req.params.type);
    res.json({ success: true, data: stocks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/sector/:name
router.get('/sector/:name', async (req, res) => {
  try {
    const stocks = await MarketDataService.getSectorStocks(req.params.name);
    res.json({ success: true, data: stocks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/fundamentals/:symbol
router.get('/fundamentals/:symbol', async (req, res) => {
  try {
    const data = await MarketDataService.getFundamentals(req.params.symbol);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/news/:symbol
router.get('/news/:symbol', async (req, res) => {
  try {
    const data = await MarketDataService.getStockNews(req.params.symbol);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/indicators/:symbol?period=200
router.get('/indicators/:symbol', async (req, res) => {
  try {
    const { period = 200 } = req.query;
    const data = await MarketDataService.getTechnicalIndicators(req.params.symbol, parseInt(period));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/screener
router.get('/screener', async (req, res) => {
  try {
    const data = await MarketDataService.screener(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/stocks/sector-heatmap
router.get('/sector-heatmap', async (req, res) => {
  try {
    const data = await MarketDataService.getSectorHeatmap();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
