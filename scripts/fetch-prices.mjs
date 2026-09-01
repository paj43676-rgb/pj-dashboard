import fs from 'node:fs/promises';
import path from 'node:path';
import { buildAlertFeed, enrichNewsItem } from '../shared/market-intel.js';

const OUTPUT_PATHS = ['data/prices.json', 'public/data/prices.json'];
const NEWS_FEED_DELAY = 250;
const DEFAULT_HEADERS = { 'User-Agent': 'fx-dashboard-bot/2.0 (+github actions cache builder)' };

const SYMBOLS = {
  gold: {
    label: 'Gold',
    decimals: 2,
    yahoo: 'GC=F',
    twelvedata: 'XAU/USD',
    providers: ['twelvedata', 'yahoo'],
  },
  eurusd: {
    label: 'EUR/USD',
    decimals: 4,
    yahoo: 'EURUSD=X',
    twelvedata: 'EUR/USD',
    frankfurter: ['EUR', 'USD'],
    providers: ['twelvedata', 'frankfurter+yahoo', 'yahoo'],
  },
  gbpusd: {
    label: 'GBP/USD',
    decimals: 4,
    yahoo: 'GBPUSD=X',
    twelvedata: 'GBP/USD',
    frankfurter: ['GBP', 'USD'],
    providers: ['twelvedata', 'frankfurter+yahoo', 'yahoo'],
  },
  usdjpy: {
    label: 'USD/JPY',
    decimals: 3,
    yahoo: 'USDJPY=X',
    twelvedata: 'USD/JPY',
    frankfurter: ['USD', 'JPY'],
    providers: ['twelvedata', 'frankfurter+yahoo', 'yahoo'],
  },
  btc: {
    label: 'BTC/USD',
    decimals: 2,
    binance: 'BTCUSDT',
    coinbase: 'BTC-USD',
    coingecko: 'bitcoin',
    yahoo: 'BTC-USD',
    providers: ['binance', 'coinbase', 'coingecko', 'yahoo'],
  },
};

const FRAMES = {
  s1m: { limit: 240, td: '1min', yahooInterval: '1m', yahooRange: '1d', binance: '1m', coinbaseGranularity: 60, coinbaseHours: 4 },
  s5: { limit: 160, td: '5min', yahooInterval: '5m', yahooRange: '5d', binance: '5m', coinbaseGranularity: 300, coinbaseHours: 14 },
  s15: { limit: 160, td: '15min', yahooInterval: '15m', yahooRange: '1mo', binance: '15m', coinbaseGranularity: 900, coinbaseHours: 40 },
  s1h: { limit: 200, td: '1h', yahooInterval: '60m', yahooRange: '3mo', binance: '1h', coinbaseGranularity: 3600, coinbaseHours: 220 },
  s1d: { limit: 180, td: '1day', yahooInterval: '1d', yahooRange: '6mo', binance: '1d', coinbaseGranularity: 86400, coinbaseHours: 180 * 24 },
  s1w: { limit: 104, td: '1week', yahooInterval: '1wk', yahooRange: '2y', binance: '1w', coinbaseGranularity: 604800, coinbaseHours: 104 * 24 * 7 },
};

const FEEDS = [
  ['https://www.fxstreet.com/rss/news', 'FXStreet'],
  ['https://www.forexlive.com/feed/news', 'ForexLive'],
  ['https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk'],
  ['https://news.google.com/rss/search?q=gold+OR+xauusd+OR+bullion&hl=en-US&gl=US&ceid=US:en', 'Google News'],
  ['https://news.google.com/rss/search?q=bitcoin+OR+btc+OR+crypto&hl=en-US&gl=US&ceid=US:en', 'Google News'],
  ['https://news.google.com/rss/search?q=forex+OR+federal+reserve+OR+ecb+OR+boj+OR+boe&hl=en-US&gl=US&ceid=US:en', 'Google News'],
  ['https://news.google.com/rss/search?q=jackson+hole+fed+warsh+gold+bitcoin+eurusd&hl=en-US&gl=US&ceid=US:en', 'Google News'],
  ['https://www.investing.com/rss/news_301.rss', 'Investing.com'],
];

const NOISE_HINTS = /(football|basketball|baseball|volleyball|speedway|race of champions|gold cup|gold medal|rawlings|coach|quarterback|season opener|debut|uniform|swimswam|mlive|floracing|yahoo sports|sporting tribune|duke basketball|garden plants|construction workers|sewer|childhood cancer|mystics|pacers|steelers|iowa|fargodome)/i;
const TRUSTED_NEWS_SOURCES = /(fxstreet|forexlive|coindesk|investing\.com|cointelegraph|cryptoslate|cryptopotato|kitco|yahoo finance|bloomberg|reuters|marketwatch|morningstar|fortune|tradingview|coinpedia|ccn|motley fool|marketbeat|streetwise reports|robinhood|crypto news|cryptorank|ambcrypto)/i;
const FINANCE_HINTS = /(bitcoin|btc|crypto|etf|gold|xau|bullion|fed|fomc|warsh|powell|ecb|boj|boe|forex|eurusd|gbpusd|usdjpy|dollar|inflation|payroll|pce|cpi|treasury|bond|yield|economy|central bank|rates?|commodit)/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, { headers: DEFAULT_HEADERS, ...options });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, { headers: DEFAULT_HEADERS, ...options });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function normalizeSeries(points = [], decimals = 2, limit = 180) {
  const cleaned = points
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.c))
    .sort((a, b) => a.t - b.t)
    .slice(-limit)
    .map((point) => ({ t: point.t, c: round(point.c, Math.min(decimals + 2, 6)) }));

  return {
    t: cleaned.map((point) => point.t),
    c: cleaned.map((point) => point.c),
  };
}

async function yahooChart(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
  const data = await fetchJSON(url);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo bad payload for ${symbol}`);
  const ts = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const points = [];
  for (let i = 0; i < ts.length; i += 1) {
    if (closes[i] != null) points.push({ t: ts[i] * 1000, c: Number(closes[i]) });
  }
  return {
    p: Number(result.meta?.regularMarketPrice ?? points.at(-1)?.c),
    pc: Number(result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? points.at(-2)?.c),
    points,
  };
}

async function buildFromYahoo(id, config) {
  const daily = await yahooChart(config.yahoo, FRAMES.s1d.yahooInterval, FRAMES.s1d.yahooRange);
  const instrument = {
    p: round(daily.p, config.decimals),
    pc: round(daily.pc, config.decimals),
    provider: 'yahoo',
    providerChain: ['yahoo'],
    s1d: normalizeSeries(daily.points, config.decimals, FRAMES.s1d.limit),
  };

  for (const [key, frame] of Object.entries(FRAMES)) {
    if (key === 's1d') continue;
    try {
      const chart = await yahooChart(config.yahoo, frame.yahooInterval, frame.yahooRange);
      instrument[key] = normalizeSeries(chart.points, config.decimals, frame.limit);
      await sleep(300);
    } catch {
      // ignore individual timeframe failure
    }
  }

  return instrument;
}

async function fetchTwelveSeries(symbol, interval, outputsize, apiKey) {
  const params = new URLSearchParams({ symbol, interval, outputsize: String(outputsize), format: 'JSON', apikey: apiKey });
  const data = await fetchJSON(`https://api.twelvedata.com/time_series?${params}`);
  if (data?.status === 'error') throw new Error(data.message || `TwelveData error ${symbol} ${interval}`);
  const values = Array.isArray(data.values) ? [...data.values].reverse() : [];
  const points = values
    .map((row) => ({ t: new Date(row.datetime).getTime(), c: Number(row.close) }))
    .filter((row) => Number.isFinite(row.t) && Number.isFinite(row.c));
  if (!points.length) throw new Error(`No TwelveData points for ${symbol} ${interval}`);
  return points;
}

async function buildFromTwelve(id, config, apiKey) {
  if (!apiKey) throw new Error('TWELVEDATA_API_KEY missing');
  const dailyPoints = await fetchTwelveSeries(config.twelvedata, FRAMES.s1d.td, FRAMES.s1d.limit, apiKey);
  const instrument = {
    p: round(dailyPoints.at(-1)?.c, config.decimals),
    pc: round(dailyPoints.at(-2)?.c ?? dailyPoints.at(-1)?.c, config.decimals),
    provider: 'twelvedata',
    providerChain: ['twelvedata'],
    s1d: normalizeSeries(dailyPoints, config.decimals, FRAMES.s1d.limit),
  };

  for (const [key, frame] of Object.entries(FRAMES)) {
    if (key === 's1d') continue;
    try {
      const points = await fetchTwelveSeries(config.twelvedata, frame.td, frame.limit, apiKey);
      instrument[key] = normalizeSeries(points, config.decimals, frame.limit);
      await sleep(200);
    } catch {
      // keep fallback silence per timeframe
    }
  }

  return instrument;
}

async function fetchFrankfurterDaily(base, quote) {
  const end = new Date();
  const start = new Date(Date.now() - 210 * 24 * 60 * 60 * 1000);
  const fmt = (value) => value.toISOString().slice(0, 10);
  const url = `https://api.frankfurter.app/${fmt(start)}..${fmt(end)}?from=${base}&to=${quote}`;
  const data = await fetchJSON(url);
  const rates = data?.rates || {};
  const points = Object.entries(rates)
    .map(([date, row]) => ({ t: new Date(`${date}T00:00:00Z`).getTime(), c: Number(row[quote]) }))
    .filter((row) => Number.isFinite(row.c))
    .sort((a, b) => a.t - b.t);
  if (!points.length) throw new Error(`No Frankfurter daily data for ${base}/${quote}`);
  return points;
}

async function buildFxFromFrankfurterYahoo(id, config) {
  const [base, quote] = config.frankfurter;
  const dailyPoints = await fetchFrankfurterDaily(base, quote);
  const yahoo = await buildFromYahoo(id, config);
  return {
    ...yahoo,
    p: round(dailyPoints.at(-1)?.c, config.decimals),
    pc: round(dailyPoints.at(-2)?.c ?? dailyPoints.at(-1)?.c, config.decimals),
    provider: 'frankfurter+yahoo',
    providerChain: ['frankfurter', 'yahoo'],
    s1d: normalizeSeries(dailyPoints, config.decimals, FRAMES.s1d.limit),
  };
}

async function binanceKlines(symbol, interval, limit) {
  const data = await fetchJSON(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  return data.map((row) => ({ t: Number(row[0]), c: Number(row[4]) }));
}

async function buildBtcFromBinance(config) {
  const ticker = await fetchJSON(`https://api.binance.com/api/v3/ticker/24hr?symbol=${config.binance}`);
  const instrument = {
    p: round(Number(ticker.lastPrice), config.decimals),
    pc: round(Number(ticker.openPrice), config.decimals),
    provider: 'binance',
    providerChain: ['binance'],
  };
  for (const [key, frame] of Object.entries(FRAMES)) {
    const points = await binanceKlines(config.binance, frame.binance, frame.limit);
    instrument[key] = normalizeSeries(points, config.decimals, frame.limit);
    await sleep(150);
  }
  return instrument;
}

async function coinbaseCandles(productId, granularity, hoursBack) {
  const end = new Date();
  const start = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const params = new URLSearchParams({
    granularity: String(granularity),
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const response = await fetch(`https://api.exchange.coinbase.com/products/${productId}/candles?${params}`, {
    headers: { ...DEFAULT_HEADERS, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Coinbase ${response.status}`);
  const rows = await response.json();
  return rows
    .map((row) => ({ t: Number(row[0]) * 1000, c: Number(row[4]) }))
    .sort((a, b) => a.t - b.t);
}

async function buildBtcFromCoinbase(config) {
  const spot = await fetchJSON(`https://api.coinbase.com/v2/prices/${config.coinbase}/spot`);
  const daily = await coinbaseCandles(config.coinbase, FRAMES.s1d.coinbaseGranularity, FRAMES.s1d.coinbaseHours);
  const instrument = {
    p: round(Number(spot?.data?.amount), config.decimals),
    pc: round(daily.at(-2)?.c ?? daily.at(-1)?.c, config.decimals),
    provider: 'coinbase',
    providerChain: ['coinbase'],
    s1d: normalizeSeries(daily, config.decimals, FRAMES.s1d.limit),
  };
  for (const [key, frame] of Object.entries(FRAMES)) {
    if (key === 's1d') continue;
    try {
      const points = await coinbaseCandles(config.coinbase, frame.coinbaseGranularity, frame.coinbaseHours);
      instrument[key] = normalizeSeries(points, config.decimals, frame.limit);
      await sleep(150);
    } catch {
      // ignore
    }
  }
  return instrument;
}

async function buildBtcFromCoinGecko(config, demoKey) {
  const headers = demoKey ? { 'x-cg-demo-api-key': demoKey } : {};
  const simple = await fetchJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${config.coingecko}&vs_currencies=usd&include_24hr_change=true`, { headers: { ...DEFAULT_HEADERS, ...headers } });
  const market = await fetchJSON(`https://api.coingecko.com/api/v3/coins/${config.coingecko}/market_chart?vs_currency=usd&days=30&interval=daily`, { headers: { ...DEFAULT_HEADERS, ...headers } });
  const dailyPoints = (market.prices || []).map(([t, c]) => ({ t, c: Number(c) }));
  return {
    p: round(Number(simple?.bitcoin?.usd), config.decimals),
    pc: round(Number(simple?.bitcoin?.usd) / (1 + Number(simple?.bitcoin?.usd_24h_change || 0) / 100), config.decimals),
    provider: 'coingecko',
    providerChain: ['coingecko'],
    s1d: normalizeSeries(dailyPoints, config.decimals, FRAMES.s1d.limit),
  };
}

async function buildInstrument(id, config, env, providerLog) {
  const providers = {
    twelvedata: () => buildFromTwelve(id, config, env.TWELVEDATA_API_KEY),
    yahoo: () => buildFromYahoo(id, config),
    'frankfurter+yahoo': () => buildFxFromFrankfurterYahoo(id, config),
    binance: () => buildBtcFromBinance(config),
    coinbase: () => buildBtcFromCoinbase(config),
    coingecko: () => buildBtcFromCoinGecko(config, env.COINGECKO_DEMO_API_KEY),
  };

  const tried = [];
  for (const provider of config.providers) {
    try {
      const result = await providers[provider]();
      providerLog[id] = { ok: true, provider, tried: [...tried, provider] };
      return result;
    } catch (error) {
      tried.push(`${provider}: ${error.message}`);
    }
  }

  providerLog[id] = { ok: false, tried };
  throw new Error(`All providers failed for ${id}: ${tried.join(' | ')}`);
}

function parseRSS(xml, defaultSource) {
  const items = [];
  const rx = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = rx.exec(xml))) {
    const block = match[1];
    const pick = (tag) => {
      const found = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i'));
      return found ? found[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() : '';
    };
    const title = pick('title');
    const pubDate = pick('pubDate') || pick('published') || pick('updated');
    let link = pick('link');
    if (!link) {
      const href = block.match(/<link[^>]*href="([^"]+)"/i);
      if (href) link = href[1];
    }
    const source = pick('source') || defaultSource;
    if (title && link) items.push({ title, link, dt: pubDate ? new Date(pubDate).getTime() : Date.now(), src: source });
  }
  return items;
}

function isRelevantMarketNews(item) {
  const title = item.title || '';
  const source = item.src || item.source || '';
  if (NOISE_HINTS.test(title) || NOISE_HINTS.test(source)) return false;
  if (TRUSTED_NEWS_SOURCES.test(source)) return true;
  return FINANCE_HINTS.test(title);
}

async function fetchNews() {
  const all = [];
  for (const [url, source] of FEEDS) {
    try {
      const xml = await fetchText(url);
      all.push(...parseRSS(xml, source));
    } catch {
      // ignore single feed failure
    }
    await sleep(NEWS_FEED_DELAY);
  }

  const seen = new Set();
  return all
    .sort((a, b) => b.dt - a.dt)
    .map((item) => enrichNewsItem(item))
    .filter(isRelevantMarketNews)
    .filter((item) => {
      const key = item.title.toLowerCase().slice(0, 90);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 90);
}

async function fetchCalendar() {
  const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  const data = await fetchJSON(url);
  return data
    .map((row) => ({
      t: new Date(row.date).getTime(),
      e: row.title,
      c: row.country,
      i: String(row.impact || 'low').toLowerCase(),
      a: row.actual || '',
      f: row.forecast || row.estimate || '',
      p: row.previous || '',
    }))
    .filter((row) => Number.isFinite(row.t))
    .sort((a, b) => a.t - b.t);
}

async function writeOutputs(payload) {
  for (const output of OUTPUT_PATHS) {
    const target = path.resolve(process.cwd(), output);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(payload));
  }
}

async function main() {
  const providerStatus = {};
  const inst = {};
  const env = process.env;

  for (const [id, config] of Object.entries(SYMBOLS)) {
    try {
      inst[id] = await buildInstrument(id, config, env, providerStatus);
      console.log('ok', id, providerStatus[id].provider, inst[id].p);
    } catch (error) {
      console.log('fail', id, error.message);
    }
    await sleep(300);
  }

  const news = await fetchNews().catch((error) => {
    console.log('news-fail', error.message);
    return [];
  });
  const cal = await fetchCalendar().catch((error) => {
    console.log('cal-fail', error.message);
    return [];
  });

  const payload = {
    ts: Date.now(),
    meta: {
      version: '2.0.0',
      focus: ['forex', 'gold', 'bitcoin'],
      providerStatus,
    },
    inst,
    news,
    cal,
  };

  const alertFeed = buildAlertFeed(payload, payload.ts);
  payload.alerts = alertFeed.items;
  payload.alertSummary = alertFeed.summary;

  await writeOutputs(payload);
  console.log('written', OUTPUT_PATHS.join(', '), 'alerts', payload.alerts.length, 'news', news.length, 'cal', cal.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

