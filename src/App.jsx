import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyze, buildSetup } from './lib/analysis';
import { ago, fa, faDateTime, fmt } from './lib/format';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const REFRESH_MS = 60 * 1000;

const instrumentMeta = {
  gold: { name: 'طلا', symbol: 'XAU/USD', type: 'metal', decimals: 2 },
  eurusd: { name: 'یورو/دلار', symbol: 'EUR/USD', type: 'fx', decimals: 4 },
  gbpusd: { name: 'پوند/دلار', symbol: 'GBP/USD', type: 'fx', decimals: 4 },
  usdjpy: { name: 'دلار/ین', symbol: 'USD/JPY', type: 'fx', decimals: 3 },
  btc: { name: 'بیت‌کوین', symbol: 'BTC/USD', type: 'crypto', decimals: 2 },
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

function sparkline(values) {
  const list = values.filter(Number.isFinite).slice(-24);
  if (!list.length) {
    return {
      path: 'M0,28 L240,28',
      color: '#94a3b8',
      width: 240,
      height: 56,
      pad: 3,
    };
  }
  const min = Math.min(...list);
  const max = Math.max(...list);
  const width = 240;
  const height = 56;
  const pad = 3;
  const range = max - min || 1;
  const path = list
    .map((value, index) => {
      const x = pad + (index / (list.length - 1 || 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / range) * (height - pad * 2);
      return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const up = list.at(-1) >= list[0];
  return { path, color: up ? '#22c55e' : '#ef4444', width, height, pad };
}

function computeNewsBadge(newsItems, seen) {
  const unseen = newsItems.filter((item) => !seen.includes(item.key)).length;
  return unseen > 9 ? '۹+' : fa(unseen);
}

function pickSeries(item) {
  const candidates = [item?.s15, item?.s1h, item?.s5, item?.s1d];
  const best = candidates.find((series) => Array.isArray(series?.c) && series.c.length > 1);
  if (!best) return [];
  return best.c.map((close, index) => ({
    close: safeNumber(close),
    time: safeNumber(best.t?.[index], Date.now() - (best.c.length - index) * 60_000),
  }));
}

function normalizeInstrument(id, item) {
  const meta = instrumentMeta[id] || {
    name: id,
    symbol: id.toUpperCase(),
    type: 'market',
    decimals: 2,
  };
  const series = pickSeries(item);
  const values = series.map((point) => point.close);
  return {
    id,
    ...meta,
    source: (item.providerChain || [item.provider]).filter(Boolean).join(' → ') || 'cache',
    price: safeNumber(item.p),
    prevClose: safeNumber(item.pc, safeNumber(item.p)),
    series,
    values,
    spark: sparkline(values),
    analysis: values.length >= 14 ? analyze(values) : null,
  };
}

function normalizeNewsItem(item) {
  const source = item.src || item.source || 'خبر';
  const published = safeNumber(item.dt || item.date, Date.now());
  const title = item.title || 'خبر بدون عنوان';
  return {
    key: item.key || `${String(item.link || '').toLowerCase()}|${title.toLowerCase()}`,
    title,
    link: item.link || '#',
    source,
    topic: item.topic || 'بازار',
    impact: normalizeImpact(item.impact),
    sentiment: item.sentiment || 'neu',
    targets: Array.isArray(item.targets) ? item.targets : [],
    date: published,
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
  const [favorites, setFavorites] = useState(() => storeGet('rfx_favs', []));
  const [marketQuery, setMarketQuery] = useState('');
  const [marketType, setMarketType] = useState('all');
  const [marketSort, setMarketSort] = useState('default');
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [newsImpact, setNewsImpact] = useState('all');
  const [newsAsset, setNewsAsset] = useState('all');
  const [newsSeen, setNewsSeen] = useState(() => storeGet('rfx_news_seen', []));
  const [calImpact, setCalImpact] = useState('all');
  const [calCountry, setCalCountry] = useState('all');
  const [alertSeverity, setAlertSeverity] = useState('all');
  const [alertAsset, setAlertAsset] = useState('all');
  const [horizon, setHorizon] = useState('s');
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString('en-GB'));
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
    const timer = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-GB'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const loadData = useCallback(async (manual = false) => {
    setState((current) => ({
      ...current,
      loading: current.lastLoaded === 0,
      refreshing: current.lastLoaded > 0,
      error: manual ? '' : current.error,
    }));

    try {
      const sessionResponse = await fetch(`${API_BASE}/session`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const sessionPayload = await parseJsonSafe(sessionResponse);

      if (sessionResponse.ok && sessionPayload?.authenticated) {
        const dashboardResponse = await fetch(`${API_BASE}/dashboard`, {
          credentials: 'include',
          headers: { accept: 'application/json' },
        });
        const dashboardPayload = await parseJsonSafe(dashboardResponse);
        if (!dashboardResponse.ok) {
          throw new Error(dashboardPayload?.error || `dashboard ${dashboardResponse.status}`);
        }

        setDashboard(dashboardPayload?.data || dashboardPayload);
        setState({
          loading: false,
          refreshing: false,
          sourceMode: 'protected',
          error: '',
          lastLoaded: Date.now(),
          authenticated: true,
        });
        return;
      }

      if (sessionResponse.status === 401 || (sessionResponse.ok && sessionPayload?.authenticated === false)) {
        setState({
          loading: false,
          refreshing: false,
          sourceMode: 'protected',
          error: 'نشست ورود منقضی شده یا از لینک اصلی Worker باز نکرده‌ای. صفحه را از همان آدرس محافظت‌شده دوباره باز کن.',
          lastLoaded: 0,
          authenticated: false,
        });
        return;
      }

      const fallbackResponse = await fetch('/data/prices.json', {
        headers: { accept: 'application/json' },
      });
      const fallbackPayload = await parseJsonSafe(fallbackResponse);
      if (!fallbackResponse.ok) {
        throw new Error('نسخه عمومی data/prices.json هم در دسترس نیست');
      }

      setDashboard(fallbackPayload);
      setState({
        loading: false,
        refreshing: false,
        sourceMode: 'public',
        error: '',
        lastLoaded: Date.now(),
        authenticated: false,
      });
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
      .map((item) => ({
        ...item,
        change: item.price - item.prevClose,
        changePct: item.prevClose ? ((item.price - item.prevClose) / item.prevClose) * 100 : 0,
      }));
  }, [dashboard]);

  const newsRows = useMemo(
    () => (dashboard?.news || []).map(normalizeNewsItem),
    [dashboard],
  );

  const calendarRows = useMemo(
    () => (dashboard?.cal || []).map(normalizeCalendarItem),
    [dashboard],
  );

  const alertsRows = useMemo(
    () => (dashboard?.alerts || []).map(normalizeAlertItem),
    [dashboard],
  );

  const alertSummary = useMemo(() => {
    const incoming = dashboard?.alertSummary;
    if (incoming) return incoming;
    return {
      critical: alertsRows.filter((item) => item.severity === 'critical').length,
      warning: alertsRows.filter((item) => item.severity === 'warning').length,
      info: alertsRows.filter((item) => item.severity === 'info').length,
    };
  }, [alertsRows, dashboard]);

  useEffect(() => {
    if (!newsRows.length) return;
    const boot = storeGet('rfx_news_boot', false);
    if (!boot) {
      const keys = newsRows.map((item) => item.key);
      setNewsSeen(keys);
      storeSet('rfx_news_seen', keys);
      storeSet('rfx_news_boot', true);
    }
  }, [newsRows]);

  useEffect(() => {
    storeSet('rfx_news_seen', newsSeen);
  }, [newsSeen]);

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
    return newsRows.filter((item) => {
      const impactOK = newsImpact === 'all' || item.impact === newsImpact;
      const assetOK = newsAsset === 'all' || item.targets.includes(newsAsset);
      return impactOK && assetOK;
    });
  }, [newsAsset, newsImpact, newsRows]);

  const filteredCalendar = useMemo(() => {
    return calendarRows.filter((item) => {
      const impactOK = calImpact === 'all' || item.impact === calImpact;
      const countryOK = calCountry === 'all' || item.country === calCountry;
      return impactOK && countryOK;
    });
  }, [calCountry, calImpact, calendarRows]);

  const filteredAlerts = useMemo(() => {
    return alertsRows.filter((item) => {
      const sevOK = alertSeverity === 'all' || item.severity === alertSeverity;
      const assetOK = alertAsset === 'all' || item.assetIds.includes(alertAsset);
      return sevOK && assetOK;
    });
  }, [alertAsset, alertSeverity, alertsRows]);

  const horizonMap = {
    s: ['کوتاه‌مدت · ۱ تا ۷ روز', 1.2],
    m: ['میان‌مدت · ۲ تا ۴ هفته', 2.5],
    l: ['بلندمدت · ۱ تا ۳ ماه', 5],
  };

  const setups = useMemo(() => {
    const penaltyByCountry = (instrumentId) => {
      const affected = {
        gold: ['USD'],
        eurusd: ['EUR', 'USD'],
        gbpusd: ['GBP', 'USD'],
        usdjpy: ['USD', 'JPY'],
        btc: ['USD', 'All'],
      }[instrumentId] || [];
      const next = calendarRows.find(
        (item) =>
          affected.includes(item.country) &&
          item.date > Date.now() &&
          item.date < Date.now() + 30 * 60 * 60 * 1000,
      );
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
        if (item.values.length < 14) return null;
        const risk = penaltyByCountry(item.id);
        const newsScore = newsScoreFor(item.id);
        return {
          item,
          risk,
          setup: buildSetup(item.values, newsScore, risk.penalty, horizonMap[horizon][1]),
        };
      })
      .filter(Boolean);
  }, [calendarRows, horizon, marketRows, newsRows]);

  const providerRows = useMemo(() => Object.entries(dashboard?.meta?.providerStatus || {}), [dashboard]);

  const summary = useMemo(() => {
    const rising = visibleMarkets.filter((item) => item.change >= 0).length;
    const falling = visibleMarkets.filter((item) => item.change < 0).length;
    const mover = [...marketRows].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
    return { rising, falling, mover };
  }, [marketRows, visibleMarkets]);

  const newsBadge = useMemo(() => computeNewsBadge(newsRows, newsSeen), [newsRows, newsSeen]);
  const alertsBadge = useMemo(() => alertSummary.critical + alertSummary.warning, [alertSummary]);

  const toggleFavorite = (id) => {
    setFavorites((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const markAllNewsSeen = () => {
    const keys = newsRows.map((item) => item.key);
    setNewsSeen(keys);
    storeSet('rfx_news_seen', keys);
  };

  const switchTab = (nextTab) => {
    setTab(nextTab);
    if (nextTab === 'news') markAllNewsSeen();
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      window.location.reload();
    }
  };

  const sourceLabel =
    state.sourceMode === 'protected'
      ? 'نسخه محافظت‌شده Worker'
      : state.sourceMode === 'public'
        ? 'نسخه عمومی cache'
        : 'در حال اتصال';

  if (state.loading && !dashboard) {
    return (
      <div className="app-shell centered-state">
        <div className="panel-card loading-card">
          <div className="section-title">در حال بارگیری داشبورد</div>
          <div className="hero-note">در حال بررسی session و دریافت JSON بازار از Worker یا فایل cache عمومی...</div>
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
            <button className="icon-btn wide-btn" onClick={() => loadData(true)}>
              تلاش دوباره
            </button>
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
            <h1>داشبورد حرفه‌ای فارکس، طلا و بیت‌کوین</h1>
            <div className="subtext">
              {sourceLabel} · آخرین بارگیری: {faDateTime(state.lastLoaded || dashboard?.ts || Date.now())} · ساعت محلی: {clock}
            </div>
          </div>
          <div className="header-actions wrap-gap">
            <span className={`live-badge ${state.sourceMode === 'public' ? 'badge-soft' : ''}`}>
              {state.sourceMode === 'protected' ? 'پشت Worker' : 'Public cache'}
            </span>
            <button className="icon-btn wide-btn" onClick={() => loadData(true)}>
              {state.refreshing ? 'در حال بروزرسانی...' : 'بروزرسانی'}
            </button>
            {state.sourceMode === 'protected' ? (
              <button className="icon-btn wide-btn" onClick={handleLogout}>
                خروج
              </button>
            ) : null}
            <button className="icon-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? '☾' : '☀'}
            </button>
          </div>
        </header>

        {state.error ? (
          <div className="error-banner">
            <b>توجه:</b> {state.error}
          </div>
        ) : null}

        <div className="tabs">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              className={`tab ${tab === key ? 'active' : ''}`}
              onClick={() => switchTab(key)}
            >
              {label}
              {key === 'news' && newsBadge !== '۰' ? <span className="nb">{newsBadge}</span> : null}
              {key === 'alerts' && alertsBadge > 0 ? <span className="nb">{fa(alertsBadge)}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'market' && (
          <section>
            <div className="hero-panel">
              <div>
                <div className="section-title">نمای کلی بازار</div>
                <div className="hero-note">
                  {state.sourceMode === 'protected'
                    ? 'الان فرانت‌اند React به Worker و /api/dashboard وصل است. یعنی سایت محافظت‌شده می‌تواند داده، خبر، تقویم و هشدار را از بک‌اند بگیرد.'
                    : 'الان این نما از data/prices.json عمومی تغذیه می‌شود. برای نسخه خصوصی و session‌دار، همین صفحه را از لینک Worker باز کن.'}
                </div>
              </div>
              <div className="hero-actions">
                <span className="badge">{fa(marketRows.length)} نماد</span>
                <span className="badge">{fa(alertSummary.critical)} هشدار بحرانی</span>
                <span className="badge">ورژن داده: {dashboard?.meta?.version || '2.x'}</span>
              </div>
            </div>

            <div className="summary-grid">
              <div className="summary-card">
                <div className="summary-label">نمادهای قابل مشاهده</div>
                <div className="summary-value">{fa(visibleMarkets.length)}</div>
                <div className="summary-meta">{fa(favorites.length)} نماد در منتخب‌ها</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">جهت بازار</div>
                <div className="summary-value">{fa(summary.rising)} / {fa(summary.falling)}</div>
                <div className="summary-meta">صعودی / نزولی</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">بیشترین نوسان</div>
                <div className={`summary-value ${summary.mover?.changePct >= 0 ? 'up' : 'down'}`}>
                  {summary.mover?.symbol || '—'}
                </div>
                <div className="summary-meta">{summary.mover ? `${summary.mover.changePct.toFixed(2)}%` : '—'}</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">آخرین timestamp داده</div>
                <div className="summary-value">{faDateTime(dashboard?.ts || Date.now())}</div>
                <div className="summary-meta">clock synced with cache</div>
              </div>
            </div>

            <div className="toolbar">
              <input
                className="mini-input"
                placeholder="جستجو: طلا، BTC، EUR..."
                value={marketQuery}
                onChange={(event) => setMarketQuery(event.target.value)}
              />
              <select className="mini-select" value={marketType} onChange={(event) => setMarketType(event.target.value)}>
                <option value="all">همه بازارها</option>
                <option value="fx">فارکس</option>
                <option value="metal">فلزات</option>
                <option value="crypto">کریپتو</option>
              </select>
              <select className="mini-select" value={marketSort} onChange={(event) => setMarketSort(event.target.value)}>
                <option value="default">پیش‌فرض</option>
                <option value="change-desc">بیشترین رشد</option>
                <option value="change-asc">بیشترین افت</option>
                <option value="price-desc">بیشترین قیمت</option>
                <option value="alpha">الفبایی</option>
              </select>
              <label className="toggle-pill">
                <input type="checkbox" checked={onlyFavs} onChange={(event) => setOnlyFavs(event.target.checked)} />
                فقط منتخب‌ها
              </label>
            </div>

            <div className="card-grid">
              {visibleMarkets.map((item) => (
                <article key={item.id} className={`market-card ${favorites.includes(item.id) ? 'favorite' : ''}`}>
                  <div className="card-head">
                    <div>
                      <div className="card-name">{item.name}</div>
                      <div className="card-symbol">{item.symbol}</div>
                    </div>
                    <div className="card-actions">
                      <span className={`tag ${item.analysis?.tone === 'up' ? 'tag-buy' : item.analysis?.tone === 'down' ? 'tag-sell' : 'tag-low'}`}>
                        {item.analysis?.label || 'داده کم'}
                      </span>
                      <button className={`fav-btn ${favorites.includes(item.id) ? 'active' : ''}`} onClick={() => toggleFavorite(item.id)}>
                        ★
                      </button>
                    </div>
                  </div>
                  <div className="card-price" dir="ltr">{fmt(item.price, item.decimals)}</div>
                  <div className={`card-change ${item.change >= 0 ? 'up' : 'down'}`} dir="ltr">
                    {item.change >= 0 ? '▲' : '▼'} {fmt(Math.abs(item.change), item.decimals)} ({item.changePct.toFixed(2)}%)
                  </div>
                  <div className="spark-wrap">
                    <svg viewBox={`0 0 ${item.spark.width} ${item.spark.height}`} preserveAspectRatio="none">
                      <path
                        d={`${item.spark.path} L${item.spark.width - item.spark.pad},${item.spark.height - item.spark.pad} L${item.spark.pad},${item.spark.height - item.spark.pad} Z`}
                        fill={item.spark.color}
                        opacity="0.11"
                      />
                      <path d={item.spark.path} fill="none" stroke={item.spark.color} strokeWidth="2" />
                    </svg>
                  </div>
                  <div className="chip-row top-gap-tight">
                    <span className="tag tag-low">RSI {item.analysis?.rsi?.toFixed(1) || '—'}</span>
                    <span className="tag tag-low">منبع: {item.source}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === 'alerts' && (
          <section>
            <div className="section-title">هشدارهای زنده</div>
            <div className="toolbar">
              <select className="mini-select" value={alertSeverity} onChange={(event) => setAlertSeverity(event.target.value)}>
                <option value="all">همه سطح‌ها</option>
                <option value="critical">بحرانی</option>
                <option value="warning">هشدار</option>
                <option value="info">اطلاع</option>
              </select>
              <select className="mini-select" value={alertAsset} onChange={(event) => setAlertAsset(event.target.value)}>
                <option value="all">همه نمادها</option>
                {marketRows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {item.symbol}
                  </option>
                ))}
              </select>
              <span className="badge">بحرانی: {fa(alertSummary.critical)} · هشدار: {fa(alertSummary.warning)} · اطلاع: {fa(alertSummary.info)}</span>
            </div>
            <div className="stack-list">
              {filteredAlerts.map((item) => (
                <div key={item.key} className="alert-card">
                  <div className="row-between wrap-gap">
                    <div>
                      <div className="pred-title">{item.title}</div>
                      <div className="summary-meta">{item.message}</div>
                    </div>
                    <div className="card-actions">
                      <span className={`tag ${severityMap[item.severity]?.[1] || 'tag-low'}`}>
                        {severityMap[item.severity]?.[0] || 'اطلاع'}
                      </span>
                      <span className="tag tag-low">{faDateTime(item.eventTime || item.createdAt)}</span>
                    </div>
                  </div>
                  <div className="chip-row top-gap-tight">
                    {item.assetIds.map((id) => (
                      <span key={id} className="tag tag-low">
                        {instrumentMeta[id]?.symbol || id}
                      </span>
                    ))}
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
            <div className="section-title">اخبار بازار</div>
            <div className="toolbar">
              <select className="mini-select" value={newsImpact} onChange={(event) => setNewsImpact(event.target.value)}>
                <option value="all">همه خبرها</option>
                <option value="high">فقط خیلی مهم</option>
                <option value="medium">فقط مهم</option>
                <option value="low">فقط عادی</option>
              </select>
              <select className="mini-select" value={newsAsset} onChange={(event) => setNewsAsset(event.target.value)}>
                <option value="all">همه نمادها</option>
                {marketRows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {item.symbol}
                  </option>
                ))}
              </select>
              <span className="badge">منابع RSS + Worker normalization</span>
            </div>
            <div className="news-list">
              {filteredNews.map((item) => (
                <article key={item.key} className={`news-item ${newsSeen.includes(item.key) ? '' : 'fresh'}`}>
                  <div className="news-time">
                    <div>{ago(item.date)}</div>
                    <div className="news-exact">{faDateTime(item.date)}</div>
                  </div>
                  <div className="news-body">
                    <div className="news-title">
                      <a href={item.link} target="_blank" rel="noreferrer">
                        {item.title} ↗
                      </a>
                    </div>
                    <div className="news-src">{item.source} · {item.topic}</div>
                    <div className="chip-row">
                      {item.targets.map((id) => (
                        <span key={id} className="tag tag-low">
                          {instrumentMeta[id]?.symbol || id}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="news-side">
                    <span className={`tag ${impactMap[item.impact]?.[1] || 'tag-low'}`}>{impactMap[item.impact]?.[0] || 'عادی'}</span>
                    <span className={`tag ${item.sentiment === 'pos' ? 'tag-buy' : item.sentiment === 'neg' ? 'tag-sell' : 'tag-low'}`}>
                      {item.sentiment === 'pos' ? 'صعودی' : item.sentiment === 'neg' ? 'نزولی' : 'خنثی'}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === 'calendar' && (
          <section>
            <div className="section-title">تقویم اقتصادی</div>
            <div className="toolbar">
              <select className="mini-select" value={calImpact} onChange={(event) => setCalImpact(event.target.value)}>
                <option value="all">همه رویدادها</option>
                <option value="high">فقط خیلی مهم</option>
                <option value="medium">فقط مهم</option>
                <option value="low">فقط عادی</option>
              </select>
              <select className="mini-select" value={calCountry} onChange={(event) => setCalCountry(event.target.value)}>
                <option value="all">همه کشورها</option>
                {Object.entries(countryMap).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="badge">آخرین تقویم هفتگی Forex Factory / Fair Economy</span>
            </div>
            <div className="calendar-list">
              {filteredCalendar.map((item) => (
                <div key={item.id} className="calendar-row">
                  <div><span>زمان</span>{faDateTime(item.date)}</div>
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
            <div className="section-title">ستاپ‌های ترکیبی</div>
            <div className="toolbar">
              {Object.entries(horizonMap).map(([key, value]) => (
                <button key={key} className={`tf-btn ${horizon === key ? 'active' : ''}`} onClick={() => setHorizon(key)}>
                  {value[0]}
                </button>
              ))}
            </div>
            <div className="hero-note section-gap">
              این بخش حالا از داده واقعی Worker و JSON کش استفاده می‌کند. یعنی score تکنیکال + sentiment خبر + جریمه‌ی خبر مهم نزدیک، با هم ستاپ می‌سازند.
            </div>
            <div className="stack-list">
              {setups.map(({ item, risk, setup }) => (
                <div key={item.id} className="setup-card">
                  <div className="row-between wrap-gap">
                    <div>
                      <div className="pred-title">{item.name} <span className="summary-meta">({item.symbol})</span></div>
                      <div className="summary-meta">{horizonMap[horizon][0]}</div>
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
                    <div className="setup-box"><div className="summary-label">RSI</div><div className="summary-value">{setup?.rsi?.toFixed(1) || '—'}</div></div>
                    <div className="setup-box"><div className="summary-label">ریسک خبر نزدیک</div><div className="summary-value">{risk.penalty ? 'بالا' : 'کم'}</div><div className="summary-meta">{risk.text}</div></div>
                    <div className="setup-box"><div className="summary-label">RR هدف ۲</div><div className="summary-value">{setup?.rr2?.toFixed(2) || '—'}</div></div>
                  </div>
                  <div className="setup-note">{setup?.note}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'plan' && (
          <section>
            <div className="section-title">پلن فنی و وضعیت مهاجرت</div>
            <div className="stack-list">
              <div className="panel-card">
                <div className="pred-title">وضعیت فعلی</div>
                <ul className="feature-list">
                  <li>فرانت‌اند React به Worker و `data/prices.json` وصل شد.</li>
                  <li>حالت protected و public هر دو پشتیبانی می‌شوند.</li>
                  <li>تب هشدارها اکنون از `alerts` و `alertSummary` واقعی استفاده می‌کند.</li>
                  <li>ستاپ‌ها از داده واقعی بازار + خبر + تقویم ساخته می‌شوند.</li>
                </ul>
              </div>
              <div className="panel-card">
                <div className="pred-title">Provider status از آخرین build</div>
                <div className="provider-list">
                  {providerRows.length ? providerRows.map(([key, value]) => (
                    <div key={key} className="provider-row">
                      <div>
                        <b>{instrumentMeta[key]?.symbol || key}</b>
                        <div className="summary-meta">{value.provider || 'fallback نامشخص'}</div>
                      </div>
                      <div className="chip-row">
                        <span className={`tag ${value.ok ? 'tag-buy' : 'tag-sell'}`}>{value.ok ? 'OK' : 'Fail'}</span>
                        <span className="tag tag-low">{(value.tried || []).slice(0, 2).join(' | ') || '—'}</span>
                      </div>
                    </div>
                  )) : <div className="hero-note">اطلاعات provider در این build موجود نیست.</div>}
                </div>
              </div>
              <div className="panel-card">
                <div className="pred-title">قدم‌های بعدی پیشنهادی</div>
                <ul className="feature-list">
                  <li>Telegram dispatch را به Worker یا GitHub Action اضافه کنیم.</li>
                  <li>برای خبرهای noisy فیلتر دقیق‌تری اضافه کنیم.</li>
                  <li>در صورت تمایل، نمودارهای بزرگ‌تر و candlestick اضافه کنیم.</li>
                  <li>اگر خواستی، مرحله بعدی من می‌تواند «ارسال هشدار تلگرام + بهبود React UI» باشد.</li>
                </ul>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
