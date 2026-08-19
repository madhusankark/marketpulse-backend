const YahooFinance = require('yahoo-finance2').default;
const { logger } = require('../config/db');
const config = require('../config/app');
const https = require('https');
const fs = require('fs');
const path = require('path');

const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });

const SECTOR_MAP_PATH = path.join(__dirname, '..', 'data', 'sector-map.json');
const CHUNK_SIZE = 100;

const FALLBACK_INDICES = [
  { symbol: '^NSEI', name: 'NIFTY 50', exchange: 'NSE', currentValue: 24072.95, previousClose: 24154.9, open: 24152.05, dayHigh: 24172.85, dayLow: 24027.9, yearHigh: 26373.2, yearLow: 22182.55, change: -81.95, changePercent: -0.34, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^BSESN', name: 'SENSEX', exchange: 'NSE', currentValue: 76903.07, previousClose: 77235.46, open: 77218.05, dayHigh: 77347.81, dayLow: 76823.91, yearHigh: 86159.02, yearLow: 71545.81, change: -332.39, changePercent: -0.43, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^NSEBANK', name: 'NIFTY BANK', exchange: 'NSE', currentValue: 57139.9, previousClose: 57262.4, open: 57260.65, dayHigh: 57356.85, dayLow: 57001.75, yearHigh: 61764.85, yearLow: 49954.85, change: -122.5, changePercent: -0.21, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^CNXIT', name: 'NIFTY IT', exchange: 'NSE', currentValue: 30390.95, previousClose: 30213.45, open: 30461.1, dayHigh: 30659.8, dayLow: 30165, yearHigh: 40301.4, yearLow: 25699.1, change: 177.5, changePercent: 0.59, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^CNXAUTO', name: 'NIFTY AUTO', exchange: 'NSE', currentValue: 29213.75, previousClose: 29264.55, open: 29224.1, dayHigh: 29317, dayLow: 29076.7, yearHigh: 29317, yearLow: 10092.6, change: -50.8, changePercent: -0.17, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^CNXPHARMA', name: 'NIFTY PHARMA', exchange: 'NSE', currentValue: 26254.3, previousClose: 26361.9, open: 26337.9, dayHigh: 26434.35, dayLow: 26251.45, yearHigh: 26801.2, yearLow: 21149.9, change: -107.6, changePercent: -0.41, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^CNXMETAL', name: 'NIFTY METAL', exchange: 'NSE', currentValue: 12971.95, previousClose: 13025.3, open: 12980.2, dayHigh: 13019, dayLow: 12907.85, yearHigh: 13019, yearLow: 4437.3, change: -53.35, changePercent: -0.41, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^CNXENERGY', name: 'NIFTY ENERGY', exchange: 'NSE', currentValue: 38215.2, previousClose: 38578.85, open: 38583.5, dayHigh: 38588.3, dayLow: 38130.8, yearHigh: 38588.3, yearLow: 21631.1, change: -363.65, changePercent: -0.94, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^CNXFMCG', name: 'NIFTY FMCG', exchange: 'NSE', currentValue: 47609.55, previousClose: 47734.8, open: 47746.6, dayHigh: 47950.7, dayLow: 47465.05, yearHigh: 48326.05, yearLow: 35826.7, change: -125.25, changePercent: -0.26, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^CNXREALTY', name: 'NIFTY REALTY', exchange: 'NSE', currentValue: 892.95, previousClose: 895.8, open: 897.65, dayHigh: 898.85, dayLow: 886.55, yearHigh: 898.85, yearLow: 365.75, change: -2.85, changePercent: -0.32, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^CNXMEDIA', name: 'NIFTY MEDIA', exchange: 'NSE', currentValue: 1601.4, previousClose: 1602.2, open: 1600.95, dayHigh: 1608.8, dayLow: 1596.15, yearHigh: 2236.1, yearLow: 1596.15, change: -0.8, changePercent: -0.05, volume: 0, lastUpdated: new Date().toISOString() },
  { symbol: '^CNXINFRA', name: 'NIFTY INFRASTRUCTURE', exchange: 'NSE', currentValue: 9318.25, previousClose: 9376.55, open: 9360.6, dayHigh: 9360.6, dayLow: 9310.4, yearHigh: 9368.75, yearLow: 4405.55, change: -58.3, changePercent: -0.62, volume: 0, lastUpdated: new Date().toISOString() }
];

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
      const batchSize = 35;
      const results = [];

      for (let i = 0; i < symbolsWithSuffix.length; i += batchSize) {
        const batch = symbolsWithSuffix.slice(i, i + batchSize);
        try {
          const quotes = await yf.quote(batch);
          const list = Array.isArray(quotes) ? quotes : [quotes];
          for (const q of list) {
            if (q && q.regularMarketPrice != null) {
              results.push(normalizeYahooQuote(q));
            }
          }
        } catch (e) {
          logger.warn(`Batch quote chunk failed (${batch.length} symbols): ${e.message}`);
        }
        if (i + batchSize < symbolsWithSuffix.length) {
          await new Promise(res => setTimeout(res, 80));
        }
      }

      if (results.length > 0) {
        cachedStocks = results;
        lastFetchTime = Date.now();
        isFirstBuildDone = true;
        logger.info(`Fetched ${results.length} active stocks in sequential batches`);
      }
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
      let rawQuotes = [];
      try {
        rawQuotes = await yf.quote(config.indexSymbols);
      } catch (e) {
        logger.warn(`Bulk index quote note: ${e.message}. Retrying individually.`);
        rawQuotes = await Promise.all(config.indexSymbols.map(sym => yf.quote(sym).catch(() => null)));
      }

      const results = (Array.isArray(rawQuotes) ? rawQuotes : [rawQuotes]).filter(Boolean);
      if (results.length > 0) {
        return results.map(q => {
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
      }
    } catch (error) {
      logger.error(`Yahoo indices error: ${error.message}`);
    }
    return FALLBACK_INDICES;
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
