import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyze, buildSetup } from './lib/analysis';
import { ago, fa, faClock, faDateTime, fmt, stalenessText, timeUntil } from './lib/format';
import { buildAlertFeed } from '../shared/market-intel.js';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const REFRESH_MS = 60 * 1000;
const TIMEFRAMES = [
  ['s1m', '1M'],
  ['s5', '5M'],
  ['s15', '15M'],
  ['s1h', '1H'],
  ['s1d', '1D'],
  ['s1w', '1W'],
];
const SETUP_FRAME_BY_HORIZON = { s: 's15', m: 's1h', l: 's1d' };

const instrumentMeta = {
  gold: { name: 'Gold', symbol: 'XAU/USD', type: 'metal', decimals: 2, tv: 'XAUUSD', yahoo: 'GC=F' },
  eurusd: { name: 'EUR/USD', symbol: 'EUR/USD', type: 'fx', decimals: 4, tv: 'EURUSD', yahoo: 'EURUSD=X' },
  gbpusd: { name: 'GBP/USD', symbol: 'GBP/USD', type: 'fx', decimals: 4, tv: 'GBPUSD', yahoo: 'GBPUSD=X' },
  usdjpy: { name: 'USD/JPY', symbol: 'USD/JPY', type: 'fx', decimals: 3, tv: 'USDJPY', yahoo: 'USDJPY=X' },
  btc: { name: 'Bitcoin', symbol: 'BTC/USD', type: 'crypto', decimals: 2, tv: 'BTCUSD', yahoo: 'BTC-USD' },
  dxy: { name: 'DXY', symbol: 'DXY', type: 'index', decimals: 2, tv: 'DXY', yahoo: 'DX-Y.NYB' },
  dji: { name: 'Dow Jones', symbol: 'DJI', type: 'index', decimals: 2, tv: 'DJI', yahoo: '%5EDJI' },
  gspc: { name: 'S&P 500', symbol: 'S&P 500', type: 'index', decimals: 2, tv: 'SPX', yahoo: '%5EGSPC' },
  ixic: { name: 'Nasdaq Composite', symbol: 'Nasdaq Composite', type: 'index', decimals: 2, tv: 'IXIC', yahoo: '%5EIXIC' },
  rut: { name: 'Russell 2000', symbol: 'Russell 2000', type: 'index', decimals: 2, tv: 'RUT', yahoo: '%5ERUT' },
  vix: { name: 'VIX', symbol: 'VIX', type: 'volatility', decimals: 2, tv: 'VIX', yahoo: '%5EVIX' },
};

const countryMap = {
  USD: 'آمریکا / دلار',
  EUR: 'منطقه یورو',
  GBP: 'بریتانیا / پوند',
  JPY: 'ژاپن / ین',
  AUD: 'استرالیا',
  NZD: 'نیوزیلند',
  CAD: 'کانادا',
  CHF: 'سوئیس',
  CNY: 'چین',
  All: 'همه بازارها',
};

const tabs = [
  ['market', 'بازار'],
  ['alerts', 'هشدارها'],
  ['news', 'اخبار'],
  ['calendar', 'تقویم'],
  ['setups', 'ستاپ‌ها'],
  ['plan', 'پلن فنی'],
];

const impactMap = {
  high: ['خیلی مهم', 'tag-high'],
  medium: ['مهم', 'tag-med'],
  low: ['عادی', 'tag-low'],
};

const severityMap = {
  critical: ['بحرانی', 'tag-high'],
  warning: ['هشدار', 'tag-med'],
  info: ['اطلاع', 'tag-low'],
};

function storeGet(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function storeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // noop
  }
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeImpact(value) {
  const v = String(value || 'low').toLowerCase();
  if (v === 'med') return 'medium';
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return 'low';
}

function frameToPoints(frame) {
  if (!frame || !Array.isArray(frame.c)) return [];
  return frame.c
    .map((close, index) => ({
      close: safeNumber(close),
      time: safeNumber(frame.t?.[index], Date.now() - (frame.c.length - index) * 60_000),
    }))
    .filter((point) => Number.isFinite(point.close));
}

function buildChart(points, width = 760, height = 280) {
  const values = points.map((point) => point.close).filter(Number.isFinite);
  if (!values.length) {
    return {
      line: `M0,${height / 2} L${width},${height / 2}`,
      fill: `M0,${height / 2} L${width},${height / 2} L${width},${height} L0,${height} Z`,
      color: '#94a3b8',
      width,
      height,
      low: 0,
      high: 0,
    };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padX = 12;
  const padY = 18;
  const path = points
    .map((point, index) => {
      const x = padX + (index / (points.length - 1 || 1)) * (width - padX * 2);
      const y = height - padY - ((point.close - min) / range) * (height - padY * 2);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const first = values[0];
  const last = values.at(-1);
  const color = last >= first ? '#22c55e' : '#ef4444';
  return {
    line: path,
    fill: `${path} L${width - padX},${height - padY} L${padX},${height - padY} Z`,
    color,
    width,
    height,
    low: min,
    high: max,
  };
}

function computeNewsBadge(newsItems, seen) {
  const unseen = newsItems.filter((item) => !seen.includes(item.key)).length;
  return unseen > 9 ? '۹+' : fa(unseen);
}

function compact(value) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

function buildTradingViewUrl(id) {
  const code = instrumentMeta[id]?.tv;
  return code ? `https://www.tradingview.com/symbols/${code}/` : null;
}

function buildYahooUrl(id) {
  const code = instrumentMeta[id]?.yahoo;
  return code ? `https://finance.yahoo.com/quote/${code}` : null;
}

function normalizeInstrument(id, item) {
  const meta = instrumentMeta[id] || { name: id, symbol: id.toUpperCase(), type: 'market', decimals: 2 };
  const frames = Object.fromEntries(
    TIMEFRAMES.map(([key]) => [key, frameToPoints(item?.[key])]).filter(([, list]) => list.length),
  );
  const defaultFrame = TIMEFRAMES.find(([key]) => frames[key]?.length)?.[0] || 's1d';
  const defaultSeries = frames[defaultFrame] || [];
  const values = defaultSeries.map((point) => point.close);
  return {
    id,
    ...meta,
    frames,
    defaultFrame,
    defaultSeries,
    values,
    price: safeNumber(item?.p),
    prevClose: safeNumber(item?.pc, safeNumber(item?.p)),
    source: (item?.providerChain || [item?.provider]).filter(Boolean).join(' → ') || 'cache',
    updatedAt: defaultSeries.at(-1)?.time || Date.now(),
  };
}

function normalizeNewsItem(item) {
  const title = item.title || 'خبر بدون عنوان';
  return {
    key: item.key || `${String(item.link || '').toLowerCase()}|${title.toLowerCase()}`,
    title,
    link: item.link || '#',
    source: item.src || item.source || 'خبر',
    topic: item.topic || 'بازار',
    impact: normalizeImpact(item.impact),
    sentiment: item.sentiment || 'neu',
    targets: Array.isArray(item.targets) ? item.targets : [],
    date: safeNumber(item.dt || item.date, Date.now()),
  };
}

function normalizeCalendarItem(item, index) {
  return {
    id: `${item.e || item.event || 'event'}-${index}-${item.t || item.date || 0}`,
    date: safeNumber(item.t || item.date, Date.now()),
    event: item.e || item.event || 'رویداد',
    country: item.c || item.country || 'All',
    previous: item.p || item.previous || '—',
    forecast: item.f || item.forecast || '—',
    actual: item.a || item.actual || '—',
    impact: normalizeImpact(item.i || item.impact),
  };
}

function normalizeAlertItem(item) {
  return {
    key: item.key || `${item.type}-${item.title}-${item.createdAt}`,
    type: item.type || 'info',
    severity: item.severity || 'info',
    title: item.title || 'هشدار',
    message: item.message || '',
    assetIds: Array.isArray(item.assetIds) ? item.assetIds : [],
    createdAt: safeNumber(item.createdAt || item.eventTime, Date.now()),
    eventTime: safeNumber(item.eventTime, 0),
    country: item.country || '',
    source: item.source || '',
  };
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function App() {
  const [tab, setTab] = useState('market');
  const [theme, setTheme] = useState(() => storeGet('rfx_theme', 'dark'));
  const [favorites, setFavorites] = useState(() => storeGet('rfx_favs', ['gold', 'btc', 'dxy']));
  const [marketQuery, setMarketQuery] = useState('');
  const [marketType, setMarketType] = useState('all');
  const [marketSort, setMarketSort] = useState('default');
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [selectedId, setSelectedId] = useState(() => storeGet('rfx_selected', 'gold'));
  const [selectedFrame, setSelectedFrame] = useState(() => storeGet('rfx_frame', 's1d'));
  const [newsImpact, setNewsImpact] = useState('all');
  const [newsAsset, setNewsAsset] = useState('all');
  const [newsOrder, setNewsOrder] = useState('newest');
  const [newsSeen, setNewsSeen] = useState(() => storeGet('rfx_news_seen', []));
  const [calImpact, setCalImpact] = useState('all');
  const [calCountry, setCalCountry] = useState('all');
  const [calendarOrder, setCalendarOrder] = useState('upcoming');
  const [alertSeverity, setAlertSeverity] = useState('all');
  const [alertAsset, setAlertAsset] = useState('all');
  const [alertOrder, setAlertOrder] = useState('newest');
  const [horizon, setHorizon] = useState('s');
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [clock, setClock] = useState(() => faClock(Date.now()));
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [alertSeen, setAlertSeen] = useState(() => storeGet('rfx_alert_seen', []));
  const [dashboard, setDashboard] = useState(null);
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    sourceMode: 'loading',
    error: '',
    lastLoaded: 0,
    authenticated: false,
  });

  useEffect(() => {
    document.body.classList.toggle('theme-light', theme === 'light');
    storeSet('rfx_theme', theme);
  }, [theme]);

  useEffect(() => {
    storeSet('rfx_favs', favorites);
  }, [favorites]);

  useEffect(() => {
    storeSet('rfx_selected', selectedId);
  }, [selectedId]);

  useEffect(() => {
    storeSet('rfx_frame', selectedFrame);
  }, [selectedFrame]);

  useEffect(() => {
    const timer = setInterval(() => setClock(faClock(Date.now())), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 320);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const loadData = useCallback(async (manual = false) => {
    const nonce = Date.now();
    setState((current) => ({
      ...current,
      loading: current.lastLoaded === 0,
      refreshing: current.lastLoaded > 0,
      error: manual ? '' : current.error,
    }));

    try {
      const sessionResponse = await fetch(`${API_BASE}/session?ts=${nonce}`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const sessionPayload = await parseJsonSafe(sessionResponse);

      if (sessionResponse.ok && sessionPayload?.authenticated) {
        const dashboardResponse = await fetch(`${API_BASE}/dashboard?ts=${nonce}`, {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });
        const dashboardPayload = await parseJsonSafe(dashboardResponse);
        if (!dashboardResponse.ok) throw new Error(dashboardPayload?.error || `dashboard ${dashboardResponse.status}`);
        setDashboard(dashboardPayload?.data || dashboardPayload);
        setState({ loading: false, refreshing: false, sourceMode: 'protected', error: '', lastLoaded: Date.now(), authenticated: true });
        return;
      }

      const fallbackResponse = await fetch(`/data/prices.json?ts=${nonce}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const fallbackPayload = await parseJsonSafe(fallbackResponse);
      if (!fallbackResponse.ok) throw new Error('نسخه عمومی data/prices.json در دسترس نیست');

      setDashboard(fallbackPayload);
      setState({ loading: false, refreshing: false, sourceMode: 'public', error: '', lastLoaded: Date.now(), authenticated: false });
    } catch (error) {
      setState({
        loading: false,
        refreshing: false,
        sourceMode: 'error',
        error: error.message || 'خطا در دریافت داده',
        lastLoaded: 0,
        authenticated: false,
      });
    }
  }, []);

  useEffect(() => {
    loadData();
    const timer = setInterval(() => loadData(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadData]);

  const marketRows = useMemo(() => {
    const inst = dashboard?.inst || {};
    return Object.entries(inst)
      .map(([id, item]) => normalizeInstrument(id, item))
      .filter((item) => Number.isFinite(item.price) && Number.isFinite(item.prevClose))
      .map((item) => {
        const defaultValues = item.defaultSeries.map((point) => point.close);
        return {
          ...item,
          change: item.price - item.prevClose,
          changePct: item.prevClose ? ((item.price - item.prevClose) / item.prevClose) * 100 : 0,
          analysis: defaultValues.length >= 14 ? analyze(defaultValues) : null,
        };
      });
  }, [dashboard]);

  useEffect(() => {
    if (!marketRows.length) return;
    if (!marketRows.some((item) => item.id === selectedId)) setSelectedId(marketRows[0].id);
  }, [marketRows, selectedId]);

  const selectedInstrument = useMemo(
    () => marketRows.find((item) => item.id === selectedId) || marketRows[0] || null,
    [marketRows, selectedId],
  );

  useEffect(() => {
    if (!selectedInstrument) return;
    const available = TIMEFRAMES.map(([key]) => key).filter((key) => selectedInstrument.frames[key]?.length);
    if (!available.includes(selectedFrame)) setSelectedFrame(selectedInstrument.defaultFrame);
  }, [selectedFrame, selectedInstrument]);

  const currentSeries = useMemo(() => {
    if (!selectedInstrument) return [];
    return selectedInstrument.frames[selectedFrame] || selectedInstrument.defaultSeries || [];
  }, [selectedFrame, selectedInstrument]);

  const currentValues = useMemo(() => currentSeries.map((point) => point.close), [currentSeries]);
  const currentAnalysis = useMemo(() => (currentValues.length >= 14 ? analyze(currentValues) : null), [currentValues]);
  const currentChart = useMemo(() => buildChart(currentSeries), [currentSeries]);

  const newsRows = useMemo(() => (dashboard?.news || []).map(normalizeNewsItem), [dashboard]);
  const calendarRows = useMemo(() => (dashboard?.cal || []).map(normalizeCalendarItem), [dashboard]);
  const liveAlertFeed = useMemo(() => buildAlertFeed({ inst: dashboard?.inst || {}, news: dashboard?.news || [], cal: dashboard?.cal || [] }, nowTs), [dashboard, nowTs]);
  const alertsRows = useMemo(() => (liveAlertFeed.items || []).map(normalizeAlertItem), [liveAlertFeed]);

  useEffect(() => {
    storeSet('rfx_news_seen', newsSeen);
  }, [newsSeen]);

  useEffect(() => {
    storeSet('rfx_alert_seen', alertSeen);
  }, [alertSeen]);

  const visibleMarkets = useMemo(() => {
    let list = marketRows.filter((item) => {
      const q = marketQuery.trim().toLowerCase();
      const hit = !q || `${item.name} ${item.symbol} ${item.id}`.toLowerCase().includes(q);
      const typeOK = marketType === 'all' || item.type === marketType;
      const favOK = !onlyFavs || favorites.includes(item.id);
      return hit && typeOK && favOK;
    });

    if (marketSort === 'change-desc') list = [...list].sort((a, b) => b.changePct - a.changePct);
    if (marketSort === 'change-asc') list = [...list].sort((a, b) => a.changePct - b.changePct);
    if (marketSort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
    if (marketSort === 'alpha') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    return list;
  }, [favorites, marketQuery, marketRows, marketSort, marketType, onlyFavs]);

  const filteredNews = useMemo(() => {
    const list = newsRows.filter((item) => {
      const impactOK = newsImpact === 'all' || item.impact === newsImpact;
      const assetOK = newsAsset === 'all' || item.targets.includes(newsAsset);
      return impactOK && assetOK;
    });
    if (newsOrder === 'oldest') return [...list].sort((a, b) => a.date - b.date);
    if (newsOrder === 'unseen-first') return [...list].sort((a, b) => Number(newsSeen.includes(a.key)) - Number(newsSeen.includes(b.key)) || b.date - a.date);
    return [...list].sort((a, b) => b.date - a.date);
  }, [newsAsset, newsImpact, newsOrder, newsRows, newsSeen]);

  const filteredCalendar = useMemo(() => {
    const list = calendarRows.filter((item) => {
      const impactOK = calImpact === 'all' || item.impact === calImpact;
      const countryOK = calCountry === 'all' || item.country === calCountry;
      return impactOK && countryOK;
    });
    if (calendarOrder === 'latest') return [...list].sort((a, b) => b.date - a.date);
    return [...list].sort((a, b) => a.date - b.date);
  }, [calCountry, calImpact, calendarOrder, calendarRows]);

  const filteredAlerts = useMemo(() => {
    const list = alertsRows.filter((item) => {
      const sevOK = alertSeverity === 'all' || item.severity === alertSeverity;
      const assetOK = alertAsset === 'all' || item.assetIds.includes(alertAsset);
      return sevOK && assetOK;
    });
    if (alertOrder === 'oldest') return [...list].sort((a, b) => (a.eventTime || a.createdAt) - (b.eventTime || b.createdAt));
    if (alertOrder === 'critical-first') return [...list].sort((a, b) => {
      const rank = { critical: 0, warning: 1, info: 2 };
      return rank[a.severity] - rank[b.severity] || (b.eventTime || b.createdAt) - (a.eventTime || a.createdAt);
    });
    return [...list].sort((a, b) => (b.eventTime || b.createdAt) - (a.eventTime || a.createdAt));
  }, [alertAsset, alertOrder, alertSeverity, alertsRows]);

  const horizonMap = {
    s: ['کوتاه‌مدت · ۱ تا ۷ روز', 1.2],
    m: ['میان‌مدت · ۲ تا ۴ هفته', 2.5],
    l: ['بلندمدت · ۱ تا ۳ ماه', 5],
  };

  const setups = useMemo(() => {
    const penaltyByCountry = (instrumentId) => {
      const affected = {
        gold: ['USD', 'All'],
        eurusd: ['EUR', 'USD', 'All'],
        gbpusd: ['GBP', 'USD', 'All'],
        usdjpy: ['USD', 'JPY', 'All'],
        btc: ['USD', 'All'],
        dxy: ['USD', 'All'],
        dji: ['USD', 'All'],
        gspc: ['USD', 'All'],
        ixic: ['USD', 'All'],
        rut: ['USD', 'All'],
        vix: ['USD', 'All'],
      }[instrumentId] || [];
      const next = calendarRows.find((item) => affected.includes(item.country) && item.date > Date.now() && item.date < Date.now() + 30 * 60 * 60 * 1000);
      if (!next) return { penalty: 0, text: 'رویداد پرریسک نزدیک ندارد' };
      return {
        penalty: next.impact === 'high' ? 12 : next.impact === 'medium' ? 6 : 2,
        text: `${countryMap[next.country] || next.country} · ${faDateTime(next.date)}`,
      };
    };

    const newsScoreFor = (instrumentId) => {
      const related = newsRows.filter((item) => item.targets.includes(instrumentId));
      if (!related.length) return 50;
      const pos = related.filter((item) => item.sentiment === 'pos').length;
      const neg = related.filter((item) => item.sentiment === 'neg').length;
      return Math.max(20, Math.min(80, Math.round(50 + ((pos - neg) / related.length) * 25)));
    };

    return marketRows
      .map((item) => {
        const frameKey = SETUP_FRAME_BY_HORIZON[horizon];
        const values = (item.frames[frameKey] || item.defaultSeries).map((point) => point.close);
        if (values.length < 14) return null;
        const risk = penaltyByCountry(item.id);
        const newsScore = newsScoreFor(item.id);
        return {
          item,
          risk,
          frameKey,
          setup: buildSetup(values, newsScore, risk.penalty, horizonMap[horizon][1]),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.setup?.combo || 0) - (a.setup?.combo || 0));
  }, [calendarRows, horizon, marketRows, newsRows]);

  const alertSummary = useMemo(() => ({
    critical: alertsRows.filter((item) => item.severity === 'critical').length,
    warning: alertsRows.filter((item) => item.severity === 'warning').length,
    info: alertsRows.filter((item) => item.severity === 'info').length,
  }), [alertsRows]);

  const providerRows = useMemo(() => Object.entries(dashboard?.meta?.providerStatus || {}), [dashboard]);
  const newsBadge = useMemo(() => computeNewsBadge(newsRows, newsSeen), [newsRows, newsSeen]);
  const alertsNewCount = useMemo(() => alertsRows.filter((item) => ['critical', 'warning'].includes(item.severity) && !alertSeen.includes(item.key)).length, [alertSeen, alertsRows]);
  const alertsBadge = useMemo(() => (alertsNewCount > 9 ? '۹+' : fa(alertsNewCount)), [alertsNewCount]);
  const criticalAlerts = useMemo(() => alertsRows.filter((item) => item.severity === 'critical').slice(0, 3), [alertsRows]);
  const topSetups = useMemo(() => setups.slice(0, 3), [setups]);

  const summary = useMemo(() => {
    const rising = visibleMarkets.filter((item) => item.change >= 0).length;
    const falling = visibleMarkets.filter((item) => item.change < 0).length;
    const mover = [...marketRows].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
    return { rising, falling, mover };
  }, [marketRows, visibleMarkets]);

  const marketTypeCounts = useMemo(() => {
    return marketRows.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});
  }, [marketRows]);

  useEffect(() => {
    if (!alertsRows.length) return;
    const liveKeys = new Set(alertsRows.map((item) => item.key));
    setAlertSeen((current) => {
      const next = current.filter((key) => liveKeys.has(key));
      return next.length === current.length ? current : next;
    });
  }, [alertsRows]);

  const toggleFavorite = (id) => {
    setFavorites((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const markAllNewsSeen = () => {
    const keys = newsRows.map((item) => item.key);
    setNewsSeen(keys);
  };

  const markAllAlertsSeen = () => {
    const keys = alertsRows.map((item) => item.key);
    setAlertSeen(keys);
  };

  const switchTab = (nextTab) => {
    setTab(nextTab);
    if (nextTab === 'news') markAllNewsSeen();
    if (nextTab === 'alerts') markAllAlertsSeen();
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'include' });
    } finally {
      window.location.reload();
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const sourceLabel = state.sourceMode === 'protected' ? 'نسخه محافظت‌شده Worker' : state.sourceMode === 'public' ? 'نسخه عمومی cache' : 'در حال اتصال';
  const dataTimestamp = dashboard?.ts || 0;
  const dataStaleness = stalenessText(dataTimestamp, nowTs);
  const dataIsStale = dataTimestamp ? nowTs - dataTimestamp > 15 * 60 * 1000 : false;

  if (state.loading && !dashboard) {
    return (
      <div className="app-shell centered-state">
        <div className="panel-card loading-card">
          <div className="section-title">در حال بارگیری داشبورد</div>
          <div className="hero-note">در حال دریافت JSON بازار، خبر و تقویم از Worker یا cache سایت...</div>
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="app-shell centered-state">
        <div className="panel-card loading-card">
          <div className="section-title">بارگیری ناموفق بود</div>
          <div className="hero-note">{state.error || 'هیچ داده‌ای دریافت نشد.'}</div>
          <div className="hero-actions top-gap">
            <button className="icon-btn wide-btn" onClick={() => loadData(true)}>تلاش دوباره</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="container">
        <header className="page-header">
          <div>
            <h1>داشبورد بازارها</h1>
            <div className="subtext">{sourceLabel} · آخرین snapshot: <span className="ltr-text">{faDateTime(dataTimestamp || state.lastLoaded || nowTs)}</span> · {dataStaleness} · ساعت تهران: <span className="ltr-text">{clock}</span></div>
          </div>
          <div className="header-actions wrap-gap">
            <span className={`live-badge ${state.sourceMode === 'public' ? 'badge-soft' : ''}`}>{state.sourceMode === 'protected' ? 'Protected' : 'Public cache'}</span>
            <button className="icon-btn wide-btn" onClick={() => loadData(true)}>{state.refreshing ? '...' : 'Refresh'}</button>
            {state.authenticated ? <button className="icon-btn wide-btn" onClick={handleLogout}>خروج</button> : null}
            <button className="icon-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '☾' : '☀'}</button>
          </div>
        </header>

        {state.error ? <div className="error-banner"><b>توجه:</b> {state.error}</div> : null}
        {dataIsStale ? <div className="warn-banner"><b>داده قدیمی شده:</b> {dataStaleness}. اگر این وضعیت طولانی ماند، باید deploy-pages در GitHub دوباره اجرا شود.</div> : null}

        {criticalAlerts.length ? (
          <div className="critical-strip">
            {criticalAlerts.map((item) => (
              <div key={item.key} className="critical-chip">
                <span>🚨</span>
                <div>
                  <b>{item.title}</b>
                  <div>{item.message}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="tabs">
          {tabs.map(([key, label]) => (
            <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => switchTab(key)}>
              {label}
              {key === 'news' && newsBadge !== '۰' ? <span className="nb">{newsBadge}</span> : null}
              {key === 'alerts' && alertsNewCount > 0 ? <span className="nb">{alertsBadge}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'market' && selectedInstrument ? (
          <section>
            <div className="hero-panel">
              <div>
                <div className="section-title">رصد بازار به سبک finance board</div>
                <div className="hero-note">الان علاوه بر طلا، فارکس و بیت‌کوین، شاخص‌های مهم مثل DXY، Dow، S&P 500، Nasdaq، Russell 2000 و VIX هم وارد سیستم شده‌اند. با کلیک روی هر نماد، نمودار و جزئیاتش عوض می‌شود.</div>
              </div>
              <div className="hero-actions">
                <span className="badge">اخبار: {fa(newsRows.length)}</span>
                <span className="badge">هشدارها: {fa(alertsRows.length)}</span>
                <span className="badge">هشدار جدید: {fa(alertsNewCount)}</span>
                <span className="badge">نمادها: {fa(marketRows.length)}</span>
              </div>
            </div>

            <div className="market-layout">
              <div className="quote-panel">
                <div className="quote-header">
                  <div>
                    <div className="quote-name">{selectedInstrument.name}</div>
                    <div className="quote-symbol mixed-text"><span className="ltr-text">{selectedInstrument.symbol}</span> · <span className="ltr-text">{selectedInstrument.source}</span></div>
                  </div>
                  <div className="card-actions wrap-gap">
                    <span className={`tag ${currentAnalysis?.tone === 'up' ? 'tag-buy' : currentAnalysis?.tone === 'down' ? 'tag-sell' : 'tag-low'}`}>{currentAnalysis?.label || 'داده کم'}</span>
                    <button className={`fav-btn ${favorites.includes(selectedInstrument.id) ? 'active' : ''}`} onClick={() => toggleFavorite(selectedInstrument.id)}>★</button>
                    {buildTradingViewUrl(selectedInstrument.id) ? <a className="mini-link" href={buildTradingViewUrl(selectedInstrument.id)} target="_blank" rel="noreferrer">TradingView ↗</a> : null}
                    {buildYahooUrl(selectedInstrument.id) ? <a className="mini-link" href={buildYahooUrl(selectedInstrument.id)} target="_blank" rel="noreferrer">Yahoo ↗</a> : null}
                  </div>
                </div>

                <div className="quote-price-row">
                  <div>
                    <div className="quote-price" dir="ltr">{fmt(selectedInstrument.price, selectedInstrument.decimals)}</div>
                    <div className={`card-change ${selectedInstrument.change >= 0 ? 'up' : 'down'}`} dir="ltr">
                      {selectedInstrument.change >= 0 ? '▲' : '▼'} {fmt(Math.abs(selectedInstrument.change), selectedInstrument.decimals)} ({selectedInstrument.changePct.toFixed(2)}%)
                    </div>
                  </div>
                  <div className="quote-stats">
                    <div><span>RSI</span><b className="ltr-text">{currentAnalysis?.rsi?.toFixed(1) || '—'}</b></div>
                    <div><span>Low</span><b className="ltr-text">{fmt(currentChart.low, selectedInstrument.decimals)}</b></div>
                    <div><span>High</span><b className="ltr-text">{fmt(currentChart.high, selectedInstrument.decimals)}</b></div>
                    <div><span>Updated</span><b className="ltr-text">{faDateTime(selectedInstrument.updatedAt)}</b><small>{ago(selectedInstrument.updatedAt, nowTs)}</small></div>
                  </div>
                </div>

                <div className="timeframe-row">
                  {TIMEFRAMES.filter(([key]) => selectedInstrument.frames[key]?.length).map(([key, label]) => (
                    <button key={key} className={`tf-btn ${selectedFrame === key ? 'active' : ''}`} onClick={() => setSelectedFrame(key)}>{label}</button>
                  ))}
                </div>

                <div className="big-chart">
                  <svg viewBox={`0 0 ${currentChart.width} ${currentChart.height}`} preserveAspectRatio="none">
                    <path d={currentChart.fill} fill={currentChart.color} opacity="0.12" />
                    <path d={currentChart.line} fill="none" stroke={currentChart.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                </div>

                <div className="quote-footer-grid">
                  <div className="summary-card">
                    <div className="summary-label">نوع دارایی</div>
                    <div className="summary-value smallish">{selectedInstrument.type}</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-label">نقاط سری</div>
                    <div className="summary-value smallish">{fa(currentSeries.length)}</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-label">ATR تقریبی</div>
                    <div className="summary-value smallish" dir="ltr">{currentAnalysis?.atr ? fmt(currentAnalysis.atr, selectedInstrument.decimals) : '—'}</div>
                  </div>
                  <div className="summary-card">
                    <div className="summary-label">Pivot</div>
                    <div className="summary-value smallish" dir="ltr">{currentAnalysis?.sr ? fmt(currentAnalysis.sr.pivot, selectedInstrument.decimals) : '—'}</div>
                  </div>
                </div>
              </div>

              <aside className="watchlist-panel">
                <div className="section-title">Watchlist</div>
                <div className="toolbar compact-toolbar">
                  <input className="mini-input" placeholder="جستجو" value={marketQuery} onChange={(event) => setMarketQuery(event.target.value)} />
                  <select className="mini-select" value={marketType} onChange={(event) => setMarketType(event.target.value)}>
                    <option value="all">همه</option>
                    <option value="fx">فارکس</option>
                    <option value="metal">فلزات</option>
                    <option value="crypto">کریپتو</option>
                    <option value="index">شاخص</option>
                    <option value="volatility">نوسان</option>
                  </select>
                  <select className="mini-select" value={marketSort} onChange={(event) => setMarketSort(event.target.value)}>
                    <option value="default">ترتیب عادی</option>
                    <option value="change-desc">بیشترین رشد</option>
                    <option value="change-asc">بیشترین افت</option>
                    <option value="price-desc">بیشترین قیمت</option>
                    <option value="alpha">الفبایی</option>
                  </select>
                  <label className="toggle-pill"><input type="checkbox" checked={onlyFavs} onChange={(event) => setOnlyFavs(event.target.checked)} /> فقط منتخب‌ها</label>
                </div>
                <div className="watchlist-meta">فارکس: {fa(marketTypeCounts.fx || 0)} · شاخص: {fa(marketTypeCounts.index || 0)} · نوسان: {fa(marketTypeCounts.volatility || 0)} · هشدار فعال: {fa(alertsRows.length)} · هشدار جدید: {fa(alertsNewCount)}</div>
                <div className="watchlist-list">
                  {visibleMarkets.map((item) => (
                    <button key={item.id} className={`watchlist-item ${selectedInstrument.id === item.id ? 'active' : ''}`} onClick={() => setSelectedId(item.id)}>
                      <div>
                        <div className="card-name">{item.name}</div>
                        <div className="card-symbol">{item.symbol}</div>
                      </div>
                      <div className="watchlist-price" dir="ltr">
                        <div>{fmt(item.price, item.decimals)}</div>
                        <div className={item.change >= 0 ? 'up' : 'down'}>{item.changePct.toFixed(2)}%</div>
                      </div>
                    </button>
                  ))}
                </div>
              </aside>
            </div>

            <div className="opportunity-grid">
              {topSetups.map(({ item, setup, risk, frameKey }) => (
                <div key={item.id} className="opportunity-card">
                  <div className="row-between wrap-gap">
                    <div>
                      <div className="pred-title">{item.name}</div>
                      <div className="summary-meta mixed-text"><span className="ltr-text">{item.symbol}</span> · <span className="ltr-text">{frameKey}</span></div>
                    </div>
                    <span className={`tag ${setup.side === 'buy' ? 'tag-buy' : setup.side === 'sell' ? 'tag-sell' : 'tag-low'}`}>{setup.title}</span>
                  </div>
                  <div className="opportunity-score">اعتماد {fa(setup.combo)}٪</div>
                  <div className="summary-meta mixed-text">ورود: <span className="ltr-text">{fmt(setup.entryLow, item.decimals)} — {fmt(setup.entryHigh, item.decimals)}</span></div>
                  <div className="summary-meta mixed-text">SL: <span className="ltr-text">{fmt(setup.stop, item.decimals)}</span> | TP1: <span className="ltr-text">{fmt(setup.target1, item.decimals)}</span></div>
                  <div className="summary-meta">{risk.text}</div>
                </div>
              ))}
            </div>

            <div className="summary-grid">
              <div className="summary-card"><div className="summary-label">نمادهای قابل مشاهده</div><div className="summary-value">{fa(visibleMarkets.length)}</div><div className="summary-meta">{fa(favorites.length)} منتخب</div></div>
              <div className="summary-card"><div className="summary-label">جهت بازار</div><div className="summary-value">{fa(summary.rising)} / {fa(summary.falling)}</div><div className="summary-meta">صعودی / نزولی</div></div>
              <div className="summary-card"><div className="summary-label">بیشترین نوسان</div><div className={`summary-value ${summary.mover?.changePct >= 0 ? 'up' : 'down'}`}>{summary.mover?.symbol || '—'}</div><div className="summary-meta">{summary.mover ? `${summary.mover.changePct.toFixed(2)}%` : '—'}</div></div>
              <div className="summary-card"><div className="summary-label">آخرین timestamp</div><div className="summary-value smallish ltr-text">{faDateTime(dashboard?.ts || nowTs)}</div><div className="summary-meta">{dataStaleness}</div></div>
            </div>
          </section>
        ) : null}

        {tab === 'alerts' && (
          <section>
            <div className="section-title">هشدارها</div>
            <div className="toolbar">
              <select className="mini-select" value={alertSeverity} onChange={(event) => setAlertSeverity(event.target.value)}>
                <option value="all">همه سطح‌ها</option>
                <option value="critical">بحرانی</option>
                <option value="warning">هشدار</option>
                <option value="info">اطلاع</option>
              </select>
              <select className="mini-select" value={alertAsset} onChange={(event) => setAlertAsset(event.target.value)}>
                <option value="all">همه نمادها</option>
                {marketRows.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.symbol}</option>)}
              </select>
              <select className="mini-select" value={alertOrder} onChange={(event) => setAlertOrder(event.target.value)}>
                <option value="newest">جدیدترین</option>
                <option value="oldest">قدیمی‌ترین</option>
                <option value="critical-first">بحرانی اول</option>
              </select>
              <span className="badge">بحرانی: {fa(alertSummary.critical)} · هشدار: {fa(alertSummary.warning)} · اطلاع: {fa(alertSummary.info)} · جدید: {fa(alertsNewCount)}</span>
              <button className="icon-btn wide-btn" onClick={() => setAlertSeen([])}>همه را جدید کن</button>
              <button className="icon-btn wide-btn" onClick={markAllAlertsSeen}>همه را دیده‌شده کن</button>
            </div>
            <div className="stack-list">
              {filteredAlerts.map((item) => (
                <div key={item.key} className="alert-card">
                  <div className="row-between wrap-gap">
                    <div>
                      <div className="pred-title mixed-text">{item.title}</div>
                      <div className="summary-meta mixed-text">{item.message}</div>
                    </div>
                    <div className="card-actions">
                      <span className={`tag ${severityMap[item.severity]?.[1] || 'tag-low'}`}>{severityMap[item.severity]?.[0] || 'اطلاع'}</span>
                      <span className="tag tag-low ltr-text">{faDateTime(item.eventTime || item.createdAt)}</span>
                      <span className="tag tag-low">{item.eventTime ? timeUntil(item.eventTime, nowTs) : ago(item.createdAt, nowTs)}</span>
                    </div>
                  </div>
                  <div className="chip-row top-gap-tight">
                    {item.assetIds.map((id) => <span key={id} className="tag tag-low ltr-text">{instrumentMeta[id]?.symbol || id}</span>)}
                    {item.country ? <span className="tag tag-low">{countryMap[item.country] || item.country}</span> : null}
                    {item.source ? <span className="tag tag-low">{item.source}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'news' && (
          <section>
            <div className="section-title">اخبار</div>
            <div className="toolbar">
              <select className="mini-select" value={newsImpact} onChange={(event) => setNewsImpact(event.target.value)}>
                <option value="all">همه خبرها</option>
                <option value="high">فقط خیلی مهم</option>
                <option value="medium">فقط مهم</option>
                <option value="low">فقط عادی</option>
              </select>
              <select className="mini-select" value={newsAsset} onChange={(event) => setNewsAsset(event.target.value)}>
                <option value="all">همه نمادها</option>
                {marketRows.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.symbol}</option>)}
              </select>
              <select className="mini-select" value={newsOrder} onChange={(event) => setNewsOrder(event.target.value)}>
                <option value="newest">جدیدترین</option>
                <option value="oldest">قدیمی‌ترین</option>
                <option value="unseen-first">خوانده‌نشده اول</option>
              </select>
              <button className="icon-btn wide-btn" onClick={() => setNewsSeen([])}>همه را جدید کن</button>
              <button className="icon-btn wide-btn" onClick={markAllNewsSeen}>همه را خوانده‌شده کن</button>
            </div>
            <div className="news-list">
              {filteredNews.map((item) => (
                <article key={item.key} className={`news-item ${newsSeen.includes(item.key) ? '' : 'fresh'}`}>
                  <div className="news-time">
                    <div>{ago(item.date)}</div>
                    <div className="news-exact">{faDateTime(item.date)}</div>
                  </div>
                  <div className="news-body">
                    <div className="news-title mixed-text"><a href={item.link} target="_blank" rel="noreferrer">{item.title} ↗</a></div>
                    <div className="news-src mixed-text"><span className="ltr-text">{item.source}</span> · {item.topic}</div>
                    <div className="chip-row">
                      {item.targets.map((id) => <span key={id} className="tag tag-low ltr-text">{instrumentMeta[id]?.symbol || id}</span>)}
                    </div>
                  </div>
                  <div className="news-side">
                    <span className={`tag ${impactMap[item.impact]?.[1] || 'tag-low'}`}>{impactMap[item.impact]?.[0] || 'عادی'}</span>
                    <span className={`tag ${item.sentiment === 'pos' ? 'tag-buy' : item.sentiment === 'neg' ? 'tag-sell' : 'tag-low'}`}>{item.sentiment === 'pos' ? 'صعودی' : item.sentiment === 'neg' ? 'نزولی' : 'خنثی'}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === 'calendar' && (
          <section>
            <div className="section-title">تقویم</div>
            <div className="toolbar">
              <select className="mini-select" value={calImpact} onChange={(event) => setCalImpact(event.target.value)}>
                <option value="all">همه رویدادها</option>
                <option value="high">فقط خیلی مهم</option>
                <option value="medium">فقط مهم</option>
                <option value="low">فقط عادی</option>
              </select>
              <select className="mini-select" value={calCountry} onChange={(event) => setCalCountry(event.target.value)}>
                <option value="all">همه کشورها</option>
                {Object.entries(countryMap).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
              <select className="mini-select" value={calendarOrder} onChange={(event) => setCalendarOrder(event.target.value)}>
                <option value="upcoming">زودترها اول</option>
                <option value="latest">دیرترها اول</option>
              </select>
            </div>
            <div className="calendar-list">
              {filteredCalendar.map((item) => (
                <div key={item.id} className="calendar-row">
                  <div><span>زمان</span><div className="ltr-text">{faDateTime(item.date)}</div><small>{timeUntil(item.date, nowTs)}</small></div>
                  <div><span>رویداد</span>{item.event}</div>
                  <div><span>کشور / ارز</span>{countryMap[item.country] || item.country}</div>
                  <div dir="ltr"><span>قبلی</span>{item.previous}</div>
                  <div dir="ltr"><span>پیش‌بینی</span>{item.forecast}</div>
                  <div dir="ltr"><span>اعلام‌شده</span>{item.actual}</div>
                  <div><span>اثر</span><b className={`tag ${impactMap[item.impact]?.[1] || 'tag-low'}`}>{impactMap[item.impact]?.[0] || 'عادی'}</b></div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'setups' && (
          <section>
            <div className="section-title">ستاپ‌ها</div>
            <div className="toolbar">
              {Object.entries(horizonMap).map(([key, value]) => <button key={key} className={`tf-btn ${horizon === key ? 'active' : ''}`} onClick={() => setHorizon(key)}>{value[0]}</button>)}
            </div>
            <div className="hero-note section-gap">در این نسخه، با تغییر horizon، داده سری استفاده‌شده هم عوض می‌شود: کوتاه‌مدت = 15m، میان‌مدت = 1h، بلندمدت = 1d. بنابراین ستاپ‌ها دیگر کاملاً ثابت نمی‌مانند.</div>
            <div className="stack-list">
              {setups.map(({ item, risk, setup, frameKey }) => (
                <div key={item.id} className="setup-card">
                  <div className="row-between wrap-gap">
                    <div>
                      <div className="pred-title">{item.name} <span className="summary-meta">({item.symbol})</span></div>
                      <div className="summary-meta mixed-text">{horizonMap[horizon][0]} · داده <span className="ltr-text">{frameKey}</span></div>
                    </div>
                    <div className="card-actions">
                      <span className={`tag ${setup?.side === 'buy' ? 'tag-buy' : setup?.side === 'sell' ? 'tag-sell' : 'tag-low'}`}>{setup?.title}</span>
                      <span className="tag tag-low">اعتماد {fa(setup?.combo ?? 0)}٪</span>
                    </div>
                  </div>
                  <div className="setup-grid">
                    <div className="setup-box"><div className="summary-label">ناحیه ورود</div><div className="summary-value" dir="ltr">{fmt(setup?.entryLow ?? item.price, item.decimals)} — {fmt(setup?.entryHigh ?? item.price, item.decimals)}</div></div>
                    <div className="setup-box"><div className="summary-label">حد ضرر</div><div className="summary-value down" dir="ltr">{fmt(setup?.stop ?? item.price, item.decimals)}</div></div>
                    <div className="setup-box"><div className="summary-label">هدف اول</div><div className="summary-value up" dir="ltr">{fmt(setup?.target1 ?? item.price, item.decimals)}</div></div>
                    <div className="setup-box"><div className="summary-label">هدف دوم</div><div className="summary-value up" dir="ltr">{fmt(setup?.target2 ?? item.price, item.decimals)}</div></div>
                  </div>
                  <div className="setup-grid secondary">
                    <div className="setup-box"><div className="summary-label">تکنیکال</div><div className="summary-value">{fa(setup?.score ?? 0)}٪</div></div>
                    <div className="setup-box"><div className="summary-label">RSI</div><div className="summary-value ltr-text">{setup?.rsi?.toFixed(1) || '—'}</div></div>
                    <div className="setup-box"><div className="summary-label">ریسک خبر نزدیک</div><div className="summary-value">{risk.penalty ? 'بالا' : 'کم'}</div><div className="summary-meta">{risk.text}</div></div>
                    <div className="setup-box"><div className="summary-label">RR هدف ۲</div><div className="summary-value ltr-text">{setup?.rr2?.toFixed(2) || '—'}</div></div>
                  </div>
                  <div className="setup-note">{setup?.note}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'plan' && (
          <section>
            <div className="section-title">پلن فنی</div>
            <div className="stack-list">
              <div className="panel-card">
                <div className="pred-title">الان چرا بعضی چیزها قبلاً ثابت بودند؟</div>
                <ul className="feature-list">
                  <li>اگر GitHub Pages دوباره deploy نشود، `prices.json` همان snapshot قبلی می‌ماند.</li>
                  <li>اگر کش مرورگر/Pages شکسته نشود، refresh ظاهری کافی نیست.</li>
                  <li>اگر ستاپ‌ها از یک سری مشترک ساخته شوند، horizon فرق ظاهری دارد ولی محتوایی کم تغییر می‌کند.</li>
                </ul>
              </div>
              <div className="panel-card">
                <div className="pred-title">کدام تکنولوژی‌ها را توصیه می‌کنم؟</div>
                <ul className="feature-list">
                  <li><b>Tailwind:</b> خوب است، ولی الان اجباری نیست. وقتی UI پایدار شد اگر خواستی migrate می‌کنیم.</li>
                  <li><b>Next.js:</b> برای فاز بعد و اگر بخواهی به Cloudflare Pages/SSR بروی مفید است. برای GitHub Pages فعلی ضروری نیست.</li>
                  <li><b>PWA:</b> مفید است؛ بعد از تثبیت UI اضافه‌اش می‌کنیم.</li>
                  <li><b>RSS:</b> همین الان هم داریم؛ بعداً منابع معتبرتر را بیشتر می‌کنیم.</li>
                  <li><b>jQuery:</b> پیشنهاد نمی‌کنم چون پروژه React است.</li>
                  <li><b>core-js / priority hints:</b> فقط اگر نیاز واقعی مرورگر/عملکرد داشته باشیم اضافه می‌کنیم.</li>
                </ul>
              </div>
              <div className="panel-card">
                <div className="pred-title">بعداً برای ارتقا کدام فایل‌ها را باید عوض کنی؟</div>
                <ul className="feature-list">
                  <li><b>UI اصلی:</b> `src/App.jsx`</li>
                  <li><b>استایل‌ها:</b> `src/styles.css`</li>
                  <li><b>محاسبات تحلیل/ستاپ:</b> `src/lib/analysis.js`</li>
                  <li><b>فرمت تاریخ و اعداد:</b> `src/lib/format.js`</li>
                  <li><b>جمع‌آوری قیمت و خبر:</b> `scripts/fetch-prices.mjs`</li>
                  <li><b>منطق هشدار:</b> `shared/market-intel.js`</li>
                  <li><b>ورکر امنیت و API:</b> `worker/src/index.js` و نسخه Dashboard یعنی `worker/cloudflare-dashboard-worker.js`</li>
                  <li><b>استقرار سایت:</b> `.github/workflows/deploy-pages.yml`</li>
                </ul>
              </div>
              <div className="panel-card">
                <div className="pred-title">وضعیت providerها</div>
                <div className="provider-list">
                  {providerRows.map(([key, value]) => (
                    <div key={key} className="provider-row">
                      <div>
                        <b>{instrumentMeta[key]?.symbol || key}</b>
                        <div className="summary-meta">{value.provider || 'fallback'}</div>
                      </div>
                      <div className="chip-row">
                        <span className={`tag ${value.ok ? 'tag-buy' : 'tag-sell'}`}>{value.ok ? 'OK' : 'Fail'}</span>
                        <span className="tag tag-low">{(value.tried || []).slice(0, 2).join(' | ') || '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
      {showScrollTop ? (
        <button className="scroll-top-btn" onClick={scrollToTop} aria-label="Scroll to top">
          <span>↑</span>
          <small>بالا</small>
        </button>
      ) : null}
    </div>
  );
}
