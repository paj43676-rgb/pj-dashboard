const COUNTRY_TO_ASSETS = {
  USD: ['gold', 'eurusd', 'gbpusd', 'usdjpy', 'btc'],
  EUR: ['eurusd'],
  GBP: ['gbpusd'],
  JPY: ['usdjpy'],
  XAU: ['gold'],
  BTC: ['btc'],
  All: ['gold', 'eurusd', 'gbpusd', 'usdjpy', 'btc'],
};

const ASSET_META = {
  gold: { label: 'طلا', symbol: 'XAU/USD', type: 'metal', move: 1.4, strongMove: 2.4 },
  eurusd: { label: 'یورو/دلار', symbol: 'EUR/USD', type: 'fx', move: 0.55, strongMove: 0.9 },
  gbpusd: { label: 'پوند/دلار', symbol: 'GBP/USD', type: 'fx', move: 0.65, strongMove: 1.0 },
  usdjpy: { label: 'دلار/ین', symbol: 'USD/JPY', type: 'fx', move: 0.65, strongMove: 1.0 },
  btc: { label: 'بیت‌کوین', symbol: 'BTC/USD', type: 'crypto', move: 4.5, strongMove: 7.5 },
};

const severityRank = { critical: 0, warning: 1, info: 2 };

export function normalizeImpact(value = 'low') {
  const v = String(value).toLowerCase();
  if (v === 'med') return 'medium';
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  if (v.includes('high')) return 'high';
  if (v.includes('med')) return 'medium';
  return 'low';
}

export function inferTargetsFromText(text = '') {
  const value = String(text).toLowerCase();
  const set = new Set();

  if (/(gold|xau|bullion|silver|metals?)/i.test(value)) set.add('gold');
  if (/(bitcoin|btc|crypto|etf|coinbase|binance|stablecoin|solana|ethereum)/i.test(value)) set.add('btc');
  if (/(eur\/usd|eurusd|euro|ecb|germany|eurozone)/i.test(value)) set.add('eurusd');
  if (/(gbp\/usd|gbpusd|pound|sterling|boe|uk |british )/i.test(value)) set.add('gbpusd');
  if (/(usd\/jpy|usdjpy|yen|boj|japan)/i.test(value)) set.add('usdjpy');

  if (/(fed|fomc|powell|warsh|jackson hole|cpi|pce|payroll|nfp|jobs|inflation|treasury|dollar)/i.test(value)) {
    ['gold', 'eurusd', 'gbpusd', 'usdjpy', 'btc'].forEach((asset) => set.add(asset));
  }

  return [...set];
}

export function inferNewsImpact(title = '', source = '') {
  const text = `${title} ${source}`.toLowerCase();
  if (/(warsh|powell|fed chair|jackson hole|cpi|pce|nfp|nonfarm|payroll|rate hike|rate cut|inflation|fomc|ecb|boj|boe|gdp|jobs report|retail sales|benchmark payroll)/i.test(text)) {
    return 'high';
  }
  if (/(price forecast|steady|holds|range|speech|minutes|yields|etf inflow|auction|claims|sentiment|consumer confidence|technical backdrop|bullish|bearish)/i.test(text)) {
    return 'medium';
  }
  return 'low';
}

export function inferNewsTopic(title = '') {
  const text = title.toLowerCase();
  if (/(jackson hole|fed|ecb|boj|boe|inflation|pce|payroll|gdp|rates?)/i.test(text)) return 'کلان / سیاست پولی';
  if (/(bitcoin|crypto|solana|etf)/i.test(text)) return 'کریپتو';
  if (/(gold|xau|bullion|silver|opec|oil|wti|brent)/i.test(text)) return 'کالاها';
  if (/(eur|gbp|jpy|yen|dollar|forex)/i.test(text)) return 'فارکس';
  return 'بازار';
}

export function inferSentiment(title = '') {
  const text = title.toLowerCase();
  if (/(rally|surge|gain|holds gains|bullish|strengthens|supported|firm|breakout|resilient|tops|rise)/i.test(text)) return 'pos';
  if (/(drops|falls|slip|bearish|weaken|rejected|fades|losses|pulls back|caution|risk elevated)/i.test(text)) return 'neg';
  return 'neu';
}

export function enrichNewsItem(item) {
  const title = item.title || '';
  const targets = item.targets?.length ? item.targets : inferTargetsFromText(title);
  return {
    ...item,
    impact: normalizeImpact(item.impact || inferNewsImpact(title, item.src || item.source || '')),
    topic: item.topic || inferNewsTopic(title),
    sentiment: item.sentiment || inferSentiment(title),
    targets,
    key: item.key || `${(item.link || '').toLowerCase()}|${title.toLowerCase()}`,
  };
}

function pctChange(current, prev) {
  if (!prev) return 0;
  return ((current - prev) / prev) * 100;
}

export function computeRSI(values = [], period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function countryToAssets(code = 'All') {
  return COUNTRY_TO_ASSETS[code] || [];
}

function minutesText(minutes) {
  if (minutes < 60) return `${minutes} دقیقه دیگر`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours} ساعت و ${remain} دقیقه دیگر` : `${hours} ساعت دیگر`;
}

function buildCalendarAlerts(cal = [], now = Date.now()) {
  return cal
    .map((item) => {
      const when = Number(item.t || item.date || 0);
      const minutes = Math.round((when - now) / 60000);
      if (!Number.isFinite(when) || minutes < -5 || minutes > 12 * 60) return null;
      const impact = normalizeImpact(item.i || item.impact);
      if (impact === 'low' && minutes > 60) return null;

      let severity = 'info';
      if (impact === 'high' && minutes <= 60) severity = 'critical';
      else if ((impact === 'high' && minutes <= 180) || (impact === 'medium' && minutes <= 60)) severity = 'warning';

      const assets = countryToAssets(item.c || item.country);
      return {
        key: `cal:${item.e || item.event}:${when}`,
        type: 'calendar',
        severity,
        title: `${impact === 'high' ? 'هشدار خیلی مهم تقویم' : 'هشدار تقویم'} · ${item.c || item.country || 'بازار'}`,
        message: `${item.e || item.event} · ${minutes >= 0 ? minutesText(minutes) : 'همین حالا'} · اثر ${impact}`,
        assetIds: assets,
        country: item.c || item.country || 'All',
        eventTime: when,
        createdAt: now,
      };
    })
    .filter(Boolean);
}

function buildNewsAlerts(news = [], now = Date.now()) {
  return news
    .map((raw) => enrichNewsItem(raw))
    .map((item) => {
      const published = Number(item.dt || item.date || now);
      const ageMinutes = Math.round((now - published) / 60000);
      if (ageMinutes < 0 || ageMinutes > 6 * 60) return null;
      if (!item.targets.length) return null;
      if (item.impact === 'low' && ageMinutes > 90) return null;

      let severity = 'info';
      if (item.impact === 'high' && ageMinutes <= 120) severity = 'critical';
      else if (item.impact === 'high' || item.impact === 'medium') severity = 'warning';

      return {
        key: `news:${item.key}`,
        type: 'news',
        severity,
        title: `${severity === 'critical' ? 'خبر خیلی مهم' : 'هشدار خبری'} · ${item.topic}`,
        message: `${item.title} · ${item.src || item.source || 'خبر'} · ${ageMinutes} دقیقه قبل`,
        assetIds: item.targets,
        createdAt: published,
        source: item.src || item.source || '',
      };
    })
    .filter(Boolean);
}

function pickSeries(inst = {}) {
  return inst.s15?.c || inst.s1h?.c || inst.s5?.c || inst.s1d?.c || [];
}

function buildMarketAlerts(inst = {}, now = Date.now()) {
  return Object.entries(inst)
    .map(([id, item]) => {
      const meta = ASSET_META[id];
      if (!meta || typeof item.p !== 'number' || typeof item.pc !== 'number') return null;

      const change = pctChange(item.p, item.pc);
      const series = pickSeries(item);
      const rsi = computeRSI(series, Math.min(14, Math.max(4, series.length - 1)));
      const move = Math.abs(change);
      const strong = move >= meta.strongMove;
      const notable = move >= meta.move;
      const overbought = rsi != null && rsi >= 70;
      const oversold = rsi != null && rsi <= 30;

      if (!notable && !overbought && !oversold) return null;

      let severity = 'info';
      if (strong || overbought || oversold) severity = 'warning';
      if (strong && (meta.type === 'crypto' || overbought || oversold)) severity = 'critical';

      const direction = change >= 0 ? 'صعودی' : 'نزولی';
      const extras = [];
      if (rsi != null) extras.push(`RSI ${rsi.toFixed(1)}`);
      if (overbought) extras.push('اشباع خرید');
      if (oversold) extras.push('اشباع فروش');

      return {
        key: `market:${id}:${Math.round(change * 10)}:${Math.round(rsi || 0)}`,
        type: 'market',
        severity,
        title: `${severity === 'critical' ? 'نوسان خیلی مهم' : 'هشدار بازار'} · ${meta.label}`,
        message: `${meta.symbol} ${direction} ${move.toFixed(2)}٪ نسبت به کلوز قبلی${extras.length ? ` · ${extras.join(' · ')}` : ''}`,
        assetIds: [id],
        createdAt: now,
      };
    })
    .filter(Boolean);
}

export function buildAlertFeed(data = {}, now = Date.now()) {
  const items = dedupe([
    ...buildCalendarAlerts(data.cal || data.calendar || [], now),
    ...buildNewsAlerts(data.news || [], now),
    ...buildMarketAlerts(data.inst || data.instruments || {}, now),
  ])
    .sort((a, b) => {
      const rankDiff = severityRank[a.severity] - severityRank[b.severity];
      if (rankDiff !== 0) return rankDiff;
      return (b.eventTime || b.createdAt || 0) - (a.eventTime || a.createdAt || 0);
    })
    .slice(0, 40);

  return {
    generatedAt: now,
    items,
    summary: {
      critical: items.filter((item) => item.severity === 'critical').length,
      warning: items.filter((item) => item.severity === 'warning').length,
      info: items.filter((item) => item.severity === 'info').length,
    },
  };
}
