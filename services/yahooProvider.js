const YahooFinance = require('yahoo-finance2').default;
const { logger } = require('../config/db');
const config = require('../config/app');
const https = require('https');
const fs = require('fs');
const path = require('path');

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });

const SECTOR_MAP_PATH = path.join(__dirname, '..', 'data', 'sector-map.json');
const CHUNK_SIZE = 100;

let TRACKED_SYMBOLS = [];
let SYMBOL_TO_SECTOR = {};
let cachedStocks = null;
let lastFetchTime = 0;
let isFirstBuildDone = false;
let fetchPromise = null;

function loadSectorMapFromDisk() {
  try {
    if (fs.existsSync(SECTOR_MAP_PATH)) {
      SYMBOL_TO_SECTOR = JSON.parse(fs.readFileSync(SECTOR_MAP_PATH, 'utf8'));
      logger.info(`Sector map loaded from disk: ${Object.keys(SYMBOL_TO_SECTOR).length} symbols`);
      return true;
    }
  } catch (e) {
    logger.warn(`Could not load sector map from disk: ${e.message}`);
  }
  return false;
}

function saveSectorMapToDisk() {
  try {
    const dir = path.dirname(SECTOR_MAP_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SECTOR_MAP_PATH, JSON.stringify(SYMBOL_TO_SECTOR, null, 2));
    logger.info(`Sector map saved to disk: ${Object.keys(SYMBOL_TO_SECTOR).length} symbols`);
  } catch (e) {
    logger.error(`Could not save sector map: ${e.message}`);
  }
}

async function fetchTrackedSymbols() {
  try {
    const csv = await new Promise((resolve, reject) => {
      https.get(config.nseArchivesUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    const lines = csv.trim().split('\n').slice(1);
    TRACKED_SYMBOLS = [...new Set(lines.filter(l => l.split(',')[2] === 'EQ').map(l => l.split(',')[0]).filter(Boolean))];
    logger.info(`Tracked symbols loaded: ${TRACKED_SYMBOLS.length}`);
  } catch (error) {
    logger.error(`Fetch tracked symbols error: ${error.message}`);
  }
}

async function buildSectorMap(symbols) {
  const list = symbols || TRACKED_SYMBOLS;
  if (list.length === 0) return;
  const batchSize = config.quoteBatchSize || 10;
  try {
    const symToSector = {};
    for (let i = 0; i < list.length; i += batchSize) {
      const batch = list.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(sym =>
          yf.quoteSummary(`${sym}.NS`, { modules: ['assetProfile'] })
            .then(r => ({ sym, sector: r?.assetProfile?.sector }))
            .catch(() => ({ sym, sector: null }))
        )
      );
      for (const { sym, sector } of results) {
        if (sector) symToSector[sym] = sector;
      }
    }
    Object.assign(SYMBOL_TO_SECTOR, symToSector);
    logger.info(`Sector map built: ${Object.keys(SYMBOL_TO_SECTOR).length} symbols mapped`);
    saveSectorMapToDisk();
  } catch (error) {
    logger.error(`Sector map build error: ${error.message}`);
  }
}

function normalizeYahooQuote(q) {
  const sym = (q.symbol || '').replace('.NS', '');
  return {
    symbol: sym,
    name: q.shortName || q.longName || sym,
    exchange: 'NSE',
    sector: SYMBOL_TO_SECTOR[sym] || '',
    lastPrice: q.regularMarketPrice ?? null,
    previousClose: q.regularMarketPreviousClose ?? null,
    open: q.regularMarketOpen ?? null,
    dayHigh: q.regularMarketDayHigh ?? null,
    dayLow: q.regularMarketDayLow ?? null,
    change: q.regularMarketChange ?? null,
    changePercent: q.regularMarketChangePercent != null ? parseFloat((q.regularMarketChangePercent * 100).toFixed(2)) : null,
    volume: q.regularMarketVolume ?? null,
    turnover: q.regularMarketPrice != null && q.regularMarketVolume != null ? q.regularMarketPrice * q.regularMarketVolume : null,
    yearHigh: q.fiftyTwoWeekHigh ?? null,
    yearLow: q.fiftyTwoWeekLow ?? null,
    vwap: (q.regularMarketDayHigh && q.regularMarketDayLow && q.regularMarketPrice)
      ? +((q.regularMarketDayHigh + q.regularMarketDayLow + q.regularMarketPrice) / 3).toFixed(2)
      : null,
    lastUpdated: new Date().toISOString()
  };
}

async function fetchAllStocks() {
  const now = Date.now();
  if (isFirstBuildDone && cachedStocks && (now - lastFetchTime) < config.stocksCacheTtl) return cachedStocks;
  if (TRACKED_SYMBOLS.length === 0) return cachedStocks || [];
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const symbolsWithSuffix = TRACKED_SYMBOLS.map(s => `${s}.NS`);
      const chunks = [];
      for (let i = 0; i < symbolsWithSuffix.length; i += CHUNK_SIZE) {
        chunks.push(symbolsWithSuffix.slice(i, i + CHUNK_SIZE));
      }
      const chunkResults = await Promise.all(
        chunks.map(chunk => yf.quote(chunk).catch(e => {
          logger.warn(`Bulk quote chunk failed (${chunk.length} symbols): ${e.message}`);
          return [];
        }))
      );
      const results = [];
      for (const quotes of chunkResults) {
        for (const q of quotes) {
          if (q && q.regularMarketPrice) {
            results.push(normalizeYahooQuote(q));
          }
        }
      }
      cachedStocks = results;
      lastFetchTime = Date.now();
      isFirstBuildDone = true;
      logger.info(`Fetched ${results.length} active stocks (${chunks.length} chunks)`);
    } catch (error) {
      logger.error(`Yahoo fetchAllStocks error: ${error.message}`);
    } finally {
      fetchPromise = null;
    }
    return cachedStocks || [];
  })();

  return fetchPromise;
}

class YahooProvider {

  static async getStockQuote(nseSymbol) {
    if (!nseSymbol) return null;
    const sym = nseSymbol.toUpperCase().replace('-EQ', '');
    try {
      const q = await yf.quote(`${sym}.NS`);
      if (!q) return null;
      return {
        symbol: sym, name: q.shortName || q.longName || sym, exchange: 'NSE',
        sector: SYMBOL_TO_SECTOR[sym] || '',
        lastPrice: q.regularMarketPrice ?? null,
        previousClose: q.regularMarketPreviousClose ?? null,
        open: q.regularMarketOpen ?? null,
        dayHigh: q.regularMarketDayHigh ?? null,
        dayLow: q.regularMarketDayLow ?? null,
        close: q.regularMarketPrice ?? null,
        vwap: (q.regularMarketDayHigh && q.regularMarketDayLow && q.regularMarketPrice)
          ? +((q.regularMarketDayHigh + q.regularMarketDayLow + q.regularMarketPrice) / 3).toFixed(2)
          : null,
        change: q.regularMarketChange ?? null,
        changePercent: q.regularMarketChangePercent != null ? parseFloat((q.regularMarketChangePercent * 100).toFixed(2)) : null,
        volume: q.regularMarketVolume ?? null,
        turnover: q.regularMarketPrice != null && q.regularMarketVolume != null ? q.regularMarketPrice * q.regularMarketVolume : null,
        week52High: q.fiftyTwoWeekHigh ?? null,
        week52Low: q.fiftyTwoWeekLow ?? null,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      return {
        symbol: sym, name: sym, exchange: 'NSE', sector: '',
        lastPrice: null, previousClose: null, open: null, dayHigh: null, dayLow: null, close: null,
        vwap: null, change: null, changePercent: null, volume: null, turnover: null,
        week52High: null, week52Low: null, lastUpdated: new Date().toISOString(),
        _reasons: { _all: `Yahoo quote error: ${error.message}` }
      };
    }
  }

  static async getMostActive() {
    const all = await fetchAllStocks();
    return [...all].sort((a, b) => (b.volume || 0) - (a.volume || 0));
  }

  static async getPriceShockers() {
    const all = await fetchAllStocks();
    const sorted = [...all].sort((a, b) => b.changePercent - a.changePercent);
    return { gainers: sorted.filter(s => s.changePercent > 0), losers: sorted.filter(s => s.changePercent < 0).reverse(), timestamp: new Date().toISOString() };
  }

  static invalidateCache() { cachedStocks = null; lastFetchTime = 0; }

  static async warmCache() {
    if (cachedStocks) return cachedStocks;
    return fetchAllStocks();
  }

  static async getHistoricalData(symbol, start, end) {
    const sym = symbol.toUpperCase().replace('-EQ', '');
    try {
      const result = await yf.chart(`${sym}.NS`, { period1: start, period2: end, interval: '1d' });
      return (result?.quotes || []).filter(d => d && d.date).map(d => ({
        timestamp: new Date(d.date),
        open: d.open || 0,
        high: d.high || 0,
        low: d.low || 0,
        close: d.close || 0,
        volume: d.volume || 0
      }));
    } catch (error) {
      logger.error(`Yahoo historical error for ${sym}: ${error.message}`);
      return [];
    }
  }

  static async getIntradayData(symbol) {
    const sym = symbol.toUpperCase().replace('-EQ', '');
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    try {
      const result = await yf.chart(`${sym}.NS`, { period1: start, period2: today, interval: '1m' });
      return (result?.quotes || []).filter(d => d && d.date).map(d => ({
        timestamp: new Date(d.date),
        open: d.open || 0,
        high: d.high || 0,
        low: d.low || 0,
        close: d.close || 0,
        volume: d.volume || 0
      }));
    } catch (error) {
      logger.error(`Yahoo intraday error for ${sym}: ${error.message}`);
      return [];
    }
  }

  static async getFundamentals(symbol) {
    const sym = symbol.toUpperCase().replace('-EQ', '');
    try {
      const [q, qs] = await Promise.all([
        yf.quote(`${sym}.NS`),
        yf.quoteSummary(`${sym}.NS`, { modules: ['financialData', 'defaultKeyStatistics'] }).catch(() => null)
      ]);
      if (!q) return null;
      const fd = qs?.financialData || {};
      const dks = qs?.defaultKeyStatistics || {};
      return {
        symbol: sym,
        companyName: q.longName || q.shortName || sym,
        sector: SYMBOL_TO_SECTOR[sym] || '',
        industry: fd?.industry || dks?.industry || '',
        marketCap: q.marketCap ?? null,
        pe: q.trailingPE ?? null,
        eps: q.epsTrailingTwelveMonths ?? null,
        dividendYield: q.dividendYield != null ? q.dividendYield : null,
        bookValue: q.bookValue ?? null,
        pb: q.priceToBook ?? null,
        roe: null,
        faceValue: null,
        forwardPE: q.forwardPE ?? null,
        pegRatio: dks?.pegRatio ?? null,
        beta: dks?.beta ?? null,
        dividendRate: q.dividendRate ?? null,
        lastDividendDate: dks?.lastDividendDate ? new Date(dks.lastDividendDate * 1000).toISOString() : null,
        earningsDate: q.earningsTimestamp || null,
        analystRating: q.averageAnalystRating || null,
        enterpriseValue: dks?.enterpriseValue ?? null,
        profitMargin: fd?.profitMargins ?? null,
        revenue: fd?.totalRevenue ?? null,
        debtToEquity: fd?.debtToEquity ?? null
      };
    } catch (error) {
      logger.error(`Yahoo fundamentals error for ${sym}: ${error.message}`);
      return null;
    }
  }

  static async getIndices() {
    try {
      const results = await Promise.all(config.indexSymbols.map(sym => yf.quote(sym).catch(() => null)));
      return results.filter(Boolean).map(q => ({
        symbol: q.symbol,
        name: config.indexNames[q.symbol] || q.shortName || q.symbol,
        exchange: 'NSE',
        currentValue: q.regularMarketPrice ?? 0,
        previousClose: q.regularMarketPreviousClose ?? 0,
        open: q.regularMarketOpen ?? 0,
        dayHigh: q.regularMarketDayHigh ?? 0,
        dayLow: q.regularMarketDayLow ?? 0,
        yearHigh: q.fiftyTwoWeekHigh ?? 0,
        yearLow: q.fiftyTwoWeekLow ?? 0,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent != null ? q.regularMarketChangePercent * 100 : 0,
        volume: 0,
        lastUpdated: new Date().toISOString()
      }));
    } catch (error) {
      logger.error(`Yahoo indices error: ${error.message}`);
      return [];
    }
  }

  static getSymbolToSector() {
    return SYMBOL_TO_SECTOR;
  }

  static getSectorSymbolsMap() {
    const map = {};
    Object.entries(SYMBOL_TO_SECTOR).forEach(([sym, sector]) => {
      if (!map[sector]) map[sector] = [];
      map[sector].push(sym);
    });
    return map;
  }

}

async function init() {
  const sectorLoaded = loadSectorMapFromDisk();
  await fetchTrackedSymbols();
  await fetchAllStocks();
  if (!sectorLoaded) {
    const activeSymbols = (cachedStocks || []).map(s => s.symbol);
    await buildSectorMap(activeSymbols);
  }
}

init().catch(e => logger.error(`Init error: ${e.message}`));
setInterval(async () => {
  await fetchTrackedSymbols();
  await fetchAllStocks();
  const activeSymbols = (cachedStocks || []).map(s => s.symbol);
  await buildSectorMap(activeSymbols);
}, config.symbolRefreshInterval);

module.exports = YahooProvider;
