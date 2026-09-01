import { useEffect, useMemo, useState } from 'react';
import { calendarEvents, instruments, newsFeed, providersPlan } from './data/sampleData';
import { analyze, buildSetup } from './lib/analysis';
import { ago, fa, faDateTime, fmt } from './lib/format';

const countryMap = {
  USD: 'آمریکا / دلار',
  EUR: 'منطقه یورو',
  GBP: 'بریتانیا / پوند',
  JPY: 'ژاپن / ین',
};

const tabs = [
  ['market', 'بازار'],
  ['news', 'اخبار'],
  ['calendar', 'تقویم'],
  ['predict', 'پیش‌بینی'],
  ['setups', 'ستاپ‌ها'],
  ['plan', 'پلن فنی'],
];

const impactMap = {
  high: ['خیلی مهم', 'tag-high'],
  med: ['مهم', 'tag-med'],
  low: ['عادی', 'tag-low'],
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

function sparkline(values) {
  const list = values.slice(-16);
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
  const [horizon, setHorizon] = useState('s');
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString('en-GB'));

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

  const marketRows = useMemo(
    () =>
      instruments.map((item) => {
        const change = item.price - item.prevClose;
        const changePct = (change / item.prevClose) * 100;
        const values = item.series.map((point) => point.close);
        return {
          ...item,
          change,
          changePct,
          analysis: analyze(values),
          spark: sparkline(values),
        };
      }),
    [],
  );

  const newsRows = useMemo(
    () =>
      newsFeed.map((item) => ({
        ...item,
        key: `${item.link}|${item.title}`.toLowerCase(),
      })),
    [],
  );

  useEffect(() => {
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
      const hit =
        !q ||
        `${item.name} ${item.symbol} ${item.id}`.toLowerCase().includes(q);
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
      const impactOK =
        newsImpact === 'all' ||
        (newsImpact === 'high' && item.impact === 'high') ||
        (newsImpact === 'med' && item.impact !== 'low');
      const assetOK = newsAsset === 'all' || item.targets.includes(newsAsset);
      return impactOK && assetOK;
    });
  }, [newsAsset, newsImpact, newsRows]);

  const filteredCalendar = useMemo(() => {
    return calendarEvents.filter((item) => {
      const impactOK =
        calImpact === 'all' ||
        (calImpact === 'high' && item.impact === 'high') ||
        (calImpact === 'med' && item.impact !== 'low');
      const countryOK = calCountry === 'all' || item.country === calCountry;
      return impactOK && countryOK;
    });
  }, [calCountry, calImpact]);

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
        btc: ['USD'],
      }[instrumentId] || [];
      const next = calendarEvents.find(
        (item) =>
          affected.includes(item.country) &&
          item.date > Date.now() &&
          item.date < Date.now() + 30 * 60 * 60 * 1000,
      );
      if (!next) return { penalty: 0, text: 'رویداد پرریسک نزدیک ندارد' };
      return {
        penalty: next.impact === 'high' ? 12 : 6,
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

    return marketRows.map((item) => {
      const risk = penaltyByCountry(item.id);
      const newsScore = newsScoreFor(item.id);
      return {
        item,
        risk,
        setup: buildSetup(
          item.series.map((point) => point.close),
          newsScore,
          risk.penalty,
          horizonMap[horizon][1],
        ),
      };
    });
  }, [horizon, marketRows, newsRows]);

  const summary = useMemo(() => {
    const rising = visibleMarkets.filter((item) => item.change >= 0).length;
    const falling = visibleMarkets.filter((item) => item.change < 0).length;
    const mover = [...marketRows].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
    return { rising, falling, mover };
  }, [marketRows, visibleMarkets]);

  const newsBadge = useMemo(() => computeNewsBadge(newsRows, newsSeen), [newsRows, newsSeen]);

  const markAllNewsSeen = () => {
    const keys = newsRows.map((item) => item.key);
    setNewsSeen(keys);
    storeSet('rfx_news_seen', keys);
  };

  const switchTab = (nextTab) => {
    setTab(nextTab);
    if (nextTab === 'news') markAllNewsSeen();
  };

  const toggleFavorite = (id) => {
    setFavorites((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  return (
    <div className="app-shell">
      <div className="container">
        <header className="page-header">
          <div>
            <h1>داشبورد حرفه‌ای فارکس، طلا و بیت‌کوین</h1>
            <div className="subtext">نسخه React + معماری آماده برای Cloudflare · آخرین بروزرسانی: {clock}</div>
          </div>
          <div className="header-actions">
            <span className="live-badge">اتصال آماده</span>
            <button className="icon-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? '☾' : '☀'}
            </button>
          </div>
        </header>

        <div className="tabs">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              className={`tab ${tab === key ? 'active' : ''}`}
              onClick={() => switchTab(key)}
            >
              {label}
              {key === 'news' && newsBadge !== '۰' ? <span className="nb">{newsBadge}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'market' && (
          <section>
            <div className="hero-panel">
              <div>
                <div className="section-title">نمای کلی بازار</div>
                <div className="hero-note">
                  این نسخه شروع مهاجرت به React است: UI روان‌تر، ساختار تمیزتر، و آماده برای اتصال به Cloudflare Workers، AI و APIهای چندگانه.
                </div>
              </div>
              <span className="badge">فقط فارکس + طلا + بیت‌کوین</span>
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
                <div className={`summary-value ${summary.mover?.changePct >= 0 ? 'up' : 'down'}`}>{summary.mover?.symbol}</div>
                <div className="summary-meta">{summary.mover?.changePct.toFixed(2)}%</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">ساختار آماده برای</div>
                <div className="summary-value">AI + Workers</div>
                <div className="summary-meta">قابل توسعه روی Cloudflare</div>
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
                        {item.analysis?.label}
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
                  <div className="summary-meta">منبع پیشنهادی: {item.source}</div>
                </article>
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
                <option value="med">مهم و متوسط</option>
              </select>
              <select className="mini-select" value={newsAsset} onChange={(event) => setNewsAsset(event.target.value)}>
                <option value="all">همه نمادها</option>
                {marketRows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {item.symbol}
                  </option>
                ))}
              </select>
              <span className="badge">منابع: FXStreet / CoinDesk / ForexLive / Investing / Google News</span>
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
                      {item.targets.map((id) => {
                        const market = marketRows.find((row) => row.id === id);
                        return (
                          <span key={id} className="tag tag-low">
                            {market?.symbol || id}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="news-side">
                    <span className={`tag ${impactMap[item.impact][1]}`}>{impactMap[item.impact][0]}</span>
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
                <option value="med">مهم و متوسط</option>
              </select>
              <select className="mini-select" value={calCountry} onChange={(event) => setCalCountry(event.target.value)}>
                <option value="all">همه کشورها</option>
                {Object.keys(countryMap).map((code) => (
                  <option key={code} value={code}>
                    {countryMap[code]}
                  </option>
                ))}
              </select>
              <span className="badge">زمان‌ها دقیق و کامل نمایش داده می‌شوند</span>
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
                  <div><span>اثر</span><b className={`tag ${impactMap[item.impact][1]}`}>{impactMap[item.impact][0]}</b></div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'predict' && (
          <section>
            <div className="section-title">پیش‌بینی تکنیکال</div>
            <div className="toolbar">
              {Object.entries(horizonMap).map(([key, value]) => (
                <button key={key} className={`tf-btn ${horizon === key ? 'active' : ''}`} onClick={() => setHorizon(key)}>
                  {value[0]}
                </button>
              ))}
            </div>
            <div className="stack-list">
              {marketRows.map((item) => {
                const setup = buildSetup(item.series.map((point) => point.close), 50, 0, horizonMap[horizon][1]);
                return (
                  <div key={item.id} className="panel-card">
                    <div className="row-between">
                      <div>
                        <div className="pred-title">{item.name}</div>
                        <div className="summary-meta">{item.symbol}</div>
                      </div>
                      <span className={`tag ${setup?.tone === 'up' ? 'tag-buy' : setup?.tone === 'down' ? 'tag-sell' : 'tag-low'}`}>
                        {setup?.label} · {fa(setup?.score ?? 0)}٪
                      </span>
                    </div>
                    <div className="summary-meta">RSI: {setup?.rsi.toFixed(1)} · ATR: {fmt(setup?.atr ?? 0, item.decimals)}</div>
                    <div className="bar-wrap"><div className="bar-fill" style={{ width: `${setup?.score ?? 0}%`, background: setup?.tone === 'up' ? 'var(--up)' : setup?.tone === 'down' ? 'var(--down)' : 'var(--warn)' }} /></div>
                    <div className="row-between tiny-ltr">
                      <span>▼ {fmt(setup?.target1 ?? item.price, item.decimals)}</span>
                      <span>▲ {fmt(setup?.target2 ?? item.price, item.decimals)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'setups' && (
          <section>
            <div className="section-title">ستاپ‌های ترکیبی</div>
            <div className="hero-note section-gap">
              این بخش ترکیب تکنیکال + اخبار + تقویم است. برای نسخه نهایی، خروجی از Cloudflare Worker و APIهای واقعی می‌آید و بعد AI روی آن توضیح انسانی می‌نویسد.
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
                    <div className="setup-box"><div className="summary-label">RSI</div><div className="summary-value">{setup?.rsi.toFixed(1)}</div></div>
                    <div className="setup-box"><div className="summary-label">ریسک خبر نزدیک</div><div className="summary-value">{risk.penalty ? 'بالا' : 'کم'}</div><div className="summary-meta">{risk.text}</div></div>
                    <div className="setup-box"><div className="summary-label">RR هدف ۲</div><div className="summary-value">{setup?.rr2.toFixed(2)}</div></div>
                  </div>
                  <div className="setup-note">{setup?.note}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'plan' && (
          <section>
            <div className="section-title">پلن فنی، API و امنیت</div>
            <div className="stack-list">
              <div className="panel-card">
                <div className="pred-title">چینش پیشنهادی APIها</div>
                <ul className="feature-list">
                  <li><b>BTC:</b> {providersPlan.btc.join(' → ')}</li>
                  <li><b>فارکس:</b> {providersPlan.fx.join(' → ')}</li>
                  <li><b>طلا:</b> {providersPlan.gold.join(' → ')}</li>
                </ul>
              </div>
              <div className="panel-card">
                <div className="pred-title">امنیت واقعی</div>
                <div className="hero-note">
                  برای دسترسی فقط خودت و افراد موردنظر، بهترین راه Cloudflare Access است. رمز داخل فرانت‌اند کافی نیست؛ چون قابل مشاهده است. در نسخه نهایی، Access جلوی کل سایت می‌ایستد و بعد Worker هم می‌تواند session اختصاصی داشته باشد.
                </div>
              </div>
              <div className="panel-card">
                <div className="pred-title">AI چه‌کار می‌کند؟</div>
                <ul className="feature-list">
                  <li>خلاصه‌سازی خبرهای مهم</li>
                  <li>توضیح دلیل ستاپ خرید/فروش</li>
                  <li>پاسخ به سؤال کاربر درباره BTC / Gold / EURUSD</li>
                  <li>هشدار: AI کمک‌تحلیلی است، نه تضمین سیگنال</li>
                </ul>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
