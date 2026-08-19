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
      TRACKED_SYMBOLS = Object.keys(SYMBOL_TO_SECTOR);
      logger.info(`Sector map loaded from disk: ${TRACKED_SYMBOLS.length} symbols initialized`);
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
      const req = https.get(config.nseArchivesUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('NSE archive fetch timed out')); });
    });
    const lines = csv.trim().split('\n').slice(1);
    const downloaded = lines.filter(l => l.split(',')[2] === 'EQ').map(l => l.split(',')[0]).filter(Boolean);
    if (downloaded.length > 0) {
      TRACKED_SYMBOLS = [...new Set([...TRACKED_SYMBOLS, ...downloaded])];
      logger.info(`Tracked symbols updated: ${TRACKED_SYMBOLS.length}`);
    }
  } catch (error) {
    logger.warn(`Fetch tracked symbols note: ${error.message}. Using ${TRACKED_SYMBOLS.length} fallback symbols.`);
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
  const price = q.regularMarketPrice ?? null;
  const prevClose = q.regularMarketPreviousClose ?? null;
  let change = q.regularMarketChange ?? null;
  if (change == null && price != null && prevClose != null) {
    change = Number((price - prevClose).toFixed(2));
  }
  let changePct = q.regularMarketChangePercent ?? null;
  if (changePct == null && price != null && prevClose && prevClose !== 0) {
    changePct = Number((((price - prevClose) / prevClose) * 100).toFixed(2));
  } else if (changePct != null) {
    changePct = Number(changePct.toFixed(2));
  }

  return {
    symbol: sym,
    name: q.shortName || q.longName || sym,
    exchange: 'NSE',
    sector: SYMBOL_TO_SECTOR[sym] || '',
    lastPrice: price,
    previousClose: prevClose,
    open: q.regularMarketOpen ?? null,
    dayHigh: q.regularMarketDayHigh ?? null,
    dayLow: q.regularMarketDayLow ?? null,
    change,
    changePercent: changePct,
    volume: q.regularMarketVolume ?? null,
    turnover: price != null && q.regularMarketVolume != null ? Math.round(price * q.regularMarketVolume) : null,
    yearHigh: q.fiftyTwoWeekHigh ?? null,
    yearLow: q.fiftyTwoWeekLow ?? null,
    vwap: (q.regularMarketDayHigh && q.regularMarketDayLow && price)
      ? +((q.regularMarketDayHigh + q.regularMarketDayLow + price) / 3).toFixed(2)
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
          if (q && q.regularMarketPrice != null) {
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
    const sym = nseSymbol.toUpperCase().replace('-EQ', '').replace('.NS', '');
    try {
      const q = await yf.quote(`${sym}.NS`);
      if (!q || q.regularMarketPrice == null) return null;
      const price = q.regularMarketPrice;
      const prevClose = q.regularMarketPreviousClose ?? price;
      let change = q.regularMarketChange ?? (price - prevClose);
      change = Number(change.toFixed(2));
      let changePercent = q.regularMarketChangePercent != null
        ? Number(q.regularMarketChangePercent.toFixed(2))
        : (prevClose ? Number((((price - prevClose) / prevClose) * 100).toFixed(2)) : 0);

      return {
        symbol: sym, name: q.shortName || q.longName || sym, exchange: 'NSE',
        sector: SYMBOL_TO_SECTOR[sym] || '',
        lastPrice: price,
        previousClose: prevClose,
        open: q.regularMarketOpen ?? price,
        dayHigh: q.regularMarketDayHigh ?? price,
        dayLow: q.regularMarketDayLow ?? price,
        close: price,
        vwap: (q.regularMarketDayHigh && q.regularMarketDayLow && price)
          ? +((q.regularMarketDayHigh + q.regularMarketDayLow + price) / 3).toFixed(2)
          : price,
        change,
        changePercent,
        volume: q.regularMarketVolume ?? 0,
        turnover: q.regularMarketVolume ? Math.round(price * q.regularMarketVolume) : 0,
        week52High: q.fiftyTwoWeekHigh ?? price,
        week52Low: q.fiftyTwoWeekLow ?? price,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`getStockQuote error for ${sym}: ${error.message}`);
      return null;
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
    const sym = symbol.toUpperCase().replace('-EQ', '').replace('.NS', '');
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
    const sym = symbol.toUpperCase().replace('-EQ', '').replace('.NS', '');
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    try {
      const result = await yf.chart(`${sym}.NS`, { period1: start, period2: today, interval: '5m' });
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
    const sym = symbol.toUpperCase().replace('-EQ', '').replace('.NS', '');
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
      return results.filter(Boolean).map(q => {
        const price = q.regularMarketPrice ?? 0;
        const prevClose = q.regularMarketPreviousClose ?? price;
        let change = q.regularMarketChange ?? (price - prevClose);
        change = Number(change.toFixed(2));
        let changePercent = q.regularMarketChangePercent != null
          ? Number(q.regularMarketChangePercent.toFixed(2))
          : (prevClose ? Number((((price - prevClose) / prevClose) * 100).toFixed(2)) : 0);

        return {
          symbol: q.symbol,
          name: config.indexNames[q.symbol] || q.shortName || q.symbol,
          exchange: 'NSE',
          currentValue: price,
          previousClose: prevClose,
          open: q.regularMarketOpen ?? price,
          dayHigh: q.regularMarketDayHigh ?? price,
          dayLow: q.regularMarketDayLow ?? price,
          yearHigh: q.fiftyTwoWeekHigh ?? price,
          yearLow: q.fiftyTwoWeekLow ?? price,
          change,
          changePercent,
          volume: 0,
          lastUpdated: new Date().toISOString()
        };
      });
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
