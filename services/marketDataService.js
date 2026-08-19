const YahooProvider = require('./yahooProvider');
const { redis, logger } = require('../config/db');
const config = require('../config/app');
const axios = require('axios');

async function safeCacheGet(key) {
  try {
    if (!redis || typeof redis.get !== 'function') return null;
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch (_) {
    return null;
  }
}

async function safeCacheSet(key, ttl, data) {
  try {
    if (!redis || typeof redis.setex !== 'function') return;
    await redis.setex(key, ttl, JSON.stringify(data));
  } catch (_) {}
}

class MarketDataService {

  static async getLiveQuote(symbol) {
    const cached = await safeCacheGet(`quote:${symbol}`);
    if (cached && cached.symbol) return cached;

    const quote = await YahooProvider.getStockQuote(symbol);
    if (quote) {
      await safeCacheSet(`quote:${symbol}`, config.quoteCacheTtl, quote);
      return quote;
    }
    return null;
  }

  static async getAllQuotes() {
    const cached = await safeCacheGet('quotes:all');
    if (cached && Array.isArray(cached) && cached.length > 0) return cached;

    const quotes = await YahooProvider.getMostActive();
    if (quotes && quotes.length > 0) {
      await safeCacheSet('quotes:all', config.quotesAllCacheTtl, quotes);
    }
    return quotes || [];
  }

  static async searchStocks(query, limit = 20) {
    const all = await YahooProvider.getMostActive();
    if (!query || query.length < 1) {
      return all.slice(0, limit);
    }
    const q = query.toUpperCase();
    return all
      .filter(s => s.symbol.includes(q) || (s.name || '').toUpperCase().includes(q))
      .slice(0, limit);
  }

  static async getStockDetails(symbol) {
    const cached = await safeCacheGet(`details:${symbol}`);
    if (cached && cached.symbol) return cached;

    const quote = await this.getLiveQuote(symbol);
    if (!quote) return null;

    const details = { ...quote, sector: quote.sector || '', recentPrices: [] };

    await safeCacheSet(`details:${symbol}`, config.stockDetailsCacheTtl, details);
    return details;
  }

  static async getHistoricalPrices(symbol, days = 90) {
    const cacheKey = `history:${symbol}:${days}`;
    const cached = await safeCacheGet(cacheKey);
    let prices;

    if (cached && Array.isArray(cached) && cached.length > 0) {
      prices = cached.map(p => ({ ...p, timestamp: new Date(p.timestamp) }));
    } else {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - days);

      prices = await YahooProvider.getHistoricalData(symbol, start, end);
      if (prices && prices.length > 0) {
        await safeCacheSet(cacheKey, config.historicalPricesCacheTtl, prices);
      }
    }

    return prices || [];
  }

  static async getIntradayPrices(symbol) {
    const cacheKey = `intraday:${symbol}`;
    const cached = await safeCacheGet(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      const last = new Date(cached[cached.length - 1].timestamp);
      const now = new Date();
      if (last.toDateString() === now.toDateString()) return cached;
    }

    const points = await YahooProvider.getIntradayData(symbol);

    if (points && points.length > 0) {
      await safeCacheSet(cacheKey, config.intradayCacheTtl, points);
    }
    return points || [];
  }

  static async getMarketIndices() {
    const cached = await safeCacheGet('indices');
    if (cached && Array.isArray(cached) && cached.length > 0) return cached;

    const results = await YahooProvider.getIndices();
    if (results && results.length > 0) {
      await safeCacheSet('indices', config.indicesCacheTtl, results);
      return results;
    }

    return [];
  }

  static async getSectorPerformance() {
    const cached = await safeCacheGet('sectors');
    if (cached) return cached;

    const allStocks = await YahooProvider.warmCache();
    if (!allStocks || allStocks.length === 0) return [];

    const sectorGroups = {};
    for (const stock of allStocks) {
      const sector = stock.sector || 'Other';
      if (!sectorGroups[sector]) sectorGroups[sector] = [];
      sectorGroups[sector].push(stock);
    }

    const sectors = Object.entries(sectorGroups).map(([sectorName, sectorStocks]) => {
      const advancing = sectorStocks.filter(s => s.changePercent > 0).length;
      const declining = sectorStocks.filter(s => s.changePercent < 0).length;
      const unchanged = sectorStocks.filter(s => s.changePercent === 0).length;
      const sortedGainers = [...sectorStocks].sort((a, b) => b.changePercent - a.changePercent);
      const sortedLosers = [...sectorStocks].sort((a, b) => a.changePercent - b.changePercent);

      const changePercent = sectorStocks.length > 0
        ? sectorStocks.reduce((s, v) => s + (v.changePercent || 0), 0) / sectorStocks.length
        : 0;
      const change = sectorStocks.length > 0
        ? sectorStocks.reduce((s, v) => s + (v.change || 0), 0) / sectorStocks.length
        : 0;

      return {
        sector: sectorName,
        changePercent,
        change,
        stockCount: sectorStocks.length,
        advancing,
        declining,
        unchanged,
        topGainer: sortedGainers.length > 0 ? sortedGainers[0] : null,
        topLoser: sortedLosers.length > 0 ? sortedLosers[0] : null,
        stocks: sortedGainers.slice(0, 10),
        lastUpdated: new Date()
      };
    });

    if (sectors.length > 0) {
      await safeCacheSet('sectors', config.sectorCacheTtl, sectors);
    }
    return sectors;
  }

  static async getTopGainers(limit = 10) {
    const cached = await safeCacheGet('gainers');
    if (cached) return cached;

    let all = [];
    try {
      const shockers = await YahooProvider.getPriceShockers();
      if (shockers.gainers && shockers.gainers.length > 0) all.push(...shockers.gainers);
    } catch (_) {}

    if (all.length === 0) {
      const stocks = await YahooProvider.getMostActive();
      all.push(...stocks.filter(s => s.changePercent > 0));
    }

    const results = all.sort((a, b) => b.changePercent - a.changePercent).slice(0, limit);
    await safeCacheSet('gainers', config.gainersCacheTtl, results);
    return results;
  }

  static async getTopLosers(limit = 10) {
    const cached = await safeCacheGet('losers');
    if (cached) return cached;

    let all = [];
    try {
      const shockers = await YahooProvider.getPriceShockers();
      if (shockers.losers && shockers.losers.length > 0) all.push(...shockers.losers);
    } catch (_) {}

    if (all.length === 0) {
      const stocks = await YahooProvider.getMostActive();
      all.push(...stocks.filter(s => s.changePercent < 0));
    }

    const results = all.sort((a, b) => a.changePercent - b.changePercent).slice(0, limit);
    await safeCacheSet('losers', config.losersCacheTtl, results);
    return results;
  }

  static async getMostActive(limit = 10) {
    const cached = await safeCacheGet('most_active');
    if (cached) return cached;

    const results = await YahooProvider.getMostActive();
    const sliced = results.slice(0, limit);
    await safeCacheSet('most_active', config.mostActiveCacheTtl, sliced);
    return sliced;
  }

  static async get52WeekHighLow() {
    const quotes = await YahooProvider.getMostActive();
    const results = [];

    for (const q of quotes) {
      const h52 = q.yearHigh || 0, l52 = q.yearLow || 0, cp = q.lastPrice || 0;
      if (!h52 || !l52 || !cp) continue;
      results.push({
        symbol: q.symbol, name: q.name || q.symbol, currentPrice: cp,
        week52High: h52, week52Low: l52,
        distFromHigh: h52 ? ((h52 - cp) / h52) * 100 : 0,
        distFromLow: l52 ? ((cp - l52) / l52) * 100 : 0
      });
    }

    return {
      nearHigh52Week: results.sort((a, b) => a.distFromHigh - b.distFromHigh).slice(0, 10),
      nearLow52Week: results.sort((a, b) => a.distFromLow - b.distFromLow).slice(0, 10)
    };
  }

  static getStockCategory(s) {
    const sym = (s.symbol || '').toUpperCase();
    const name = (s.name || '').toUpperCase();
    if (sym.includes('ETF') || name.includes('ETF')) return 'etfs';
    if (name.includes('BOND') || name.includes('DEBT') || name.includes('NCD') || name.includes('DEBENTURE')) return 'debt';
    return 'equity';
  }

  static async getCategoryStocks(type) {
    const all = await YahooProvider.getMostActive();
    if (type === 'all') return all;
    return all.filter(s => MarketDataService.getStockCategory(s) === type);
  }

  static async getSectorStocks(sectorName) {
    const all = await YahooProvider.getMostActive();
    const name = sectorName.toUpperCase();
    return all.filter(s => (s.sector || '').toUpperCase() === name);
  }

  static async getAllSectors() {
    const all = await YahooProvider.warmCache();
    if (!all || all.length === 0) return [];
    const names = [...new Set(all.map(s => s.sector).filter(Boolean))];
    return names.sort();
  }

  static async getFundamentals(symbol) {
    return YahooProvider.getFundamentals(symbol);
  }

  static async getStockNews(symbol) {
    const name = symbol.toUpperCase().replace(/-EQ$/, '');
    try {
      const url = `${config.newsUrl}?q=${encodeURIComponent(name)}+NSE+stock`;
      const resp = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const xml = resp.data;
      if (!xml) return [];
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      return items.map(item => {
        let title = (item.match(/<title>(.*?)<\/title>/) || [])[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/, '$1')?.trim() || '';
        const link = (item.match(/<link>(.*?)<\/link>/) || [])[1]?.trim() || '';
        const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1]?.trim() || '';
        const sepIdx = title.lastIndexOf(' - ');
        let source = 'Google News';
        if (sepIdx !== -1) { source = title.slice(sepIdx + 3).trim(); title = title.slice(0, sepIdx).trim(); }
        return { title, url: link, date: pubDate, source, category: 'news' };
      }).filter(i => i.title)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 10);
    } catch (_) { return []; }
  }

  static async getTechnicalIndicators(symbol, period = 200) {
    try {
      const prices = await this.getHistoricalPrices(symbol, period);
      if (!prices || prices.length < 20) return null;
      const closes = prices.map(p => p.close);
      const highs = prices.map(p => p.high);
      const lows = prices.map(p => p.low);
      const volumes = prices.map(p => p.volume || 0);
      const sma = (arr, p) => { const r = []; for (let i = 0; i < arr.length; i++) { if (i < p - 1) { r.push(null); } else { r.push(arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p); } } return r; };
      const ema = (arr, p) => { const k = 2 / (p + 1); const r = [arr[0]]; for (let i = 1; i < arr.length; i++) { r.push(arr[i] * k + r[i - 1] * (1 - k)); } return r; };
      const rsi = (arr, p = 14) => {
        const changes = []; for (let i = 1; i < arr.length; i++) changes.push(arr[i] - arr[i - 1]);
        const gains = changes.map(c => c > 0 ? c : 0); const losses = changes.map(c => c < 0 ? -c : 0);
        const r = []; let avgGain = gains.slice(0, p).reduce((a, b) => a + b, 0) / p;
        let avgLoss = losses.slice(0, p).reduce((a, b) => a + b, 0) / p;
        r.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
        for (let i = p; i < changes.length; i++) {
          avgGain = (avgGain * (p - 1) + gains[i]) / p;
          avgLoss = (avgLoss * (p - 1) + losses[i]) / p;
          r.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
        }
        const padded = []; let idx = 0;
        for (let i = 0; i < arr.length; i++) { padded.push(i < p ? null : r[idx++]); }
        return padded;
      };
      const macd = (arr) => { const e12 = ema(arr, 12); const e26 = ema(arr, 26); const m = []; for (let i = 0; i < arr.length; i++) m.push(e12[i] - e26[i]); const s = ema(m.filter(v => !isNaN(v)), 9); const signal = []; let si = 0; for (let i = 0; i < arr.length; i++) signal.push(isNaN(m[i]) ? null : s[si++] || null); const h = m.map((v, i) => v != null && signal[i] != null ? v - signal[i] : null); return { macdLine: m, signal, histogram: h }; };
      return {
        sma20: sma(closes, 20), sma50: sma(closes, 50), sma200: sma(closes, 200),
        ema12: ema(closes, 12), ema26: ema(closes, 26),
        rsi14: rsi(closes, 14),
        macd: macd(closes),
        lastClose: closes[closes.length - 1]
      };
    } catch (_) { return null; }
  }

  static async screener(filters = {}) {
    const all = await YahooProvider.warmCache();
    if (!all || all.length === 0) return [];
    let filtered = [...all];
    if (filters.sector) filtered = filtered.filter(s => (s.sector || '').toUpperCase() === filters.sector.toUpperCase());
    if (filters.price_min) filtered = filtered.filter(s => s.lastPrice >= Number(filters.price_min));
    if (filters.price_max) filtered = filtered.filter(s => s.lastPrice <= Number(filters.price_max));
    if (filters.change_min) filtered = filtered.filter(s => s.changePercent >= Number(filters.change_min));
    if (filters.change_max) filtered = filtered.filter(s => s.changePercent <= Number(filters.change_max));
    if (filters.volume_min) filtered = filtered.filter(s => s.volume >= Number(filters.volume_min));
    if (filters.query) { const q = filters.query.toUpperCase(); filtered = filtered.filter(s => s.symbol.includes(q) || (s.name || '').toUpperCase().includes(q)); }
    const sortBy = filters.sort_by || 'volume';
    const sortOrder = filters.sort_order === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      const va = a[sortBy] || 0; const vb = b[sortBy] || 0;
      return va > vb ? sortOrder : va < vb ? -sortOrder : 0;
    });
    const limit = Math.min(parseInt(filters.limit) || 200, 500);
    return filtered.slice(0, limit);
  }

  static async getSectorHeatmap() {
    const all = await YahooProvider.warmCache();
    if (!all || all.length === 0) return [];
    const sectorMap = {};
    for (const stock of all) {
      const sector = stock.sector || 'Other';
      if (!sectorMap[sector]) sectorMap[sector] = { sector, stocks: [], totalChange: 0, advancing: 0, declining: 0 };
      if (stock.lastPrice > 0) {
        sectorMap[sector].stocks.push(stock);
        sectorMap[sector].totalChange += stock.changePercent || 0;
        if ((stock.changePercent || 0) > 0) sectorMap[sector].advancing++;
        else if ((stock.changePercent || 0) < 0) sectorMap[sector].declining++;
      }
    }
    return Object.values(sectorMap)
      .filter(s => s.stocks.length >= 2)
      .map(s => ({
        sector: s.sector, stockCount: s.stocks.length,
        avgChange: s.totalChange / s.stocks.length,
        advancing: s.advancing, declining: s.declining,
        topGainer: s.stocks.sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0))[0]?.symbol || '',
        topLoser: s.stocks.sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0))[0]?.symbol || ''
      }))
      .sort((a, b) => b.avgChange - a.avgChange);
  }
}

module.exports = MarketDataService;
