// Dashboard-ready single-file Worker for Cloudflare Quick Edit

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


const COOKIE_NAME = 'fxdash_session';
const DEFAULT_SESSION_DAYS = 7;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/api/health') {
        return json({ ok: true, ts: Date.now(), app: env.APP_NAME || 'FX Dashboard' });
      }

      if (url.pathname === '/api/providers') {
        return json({
          market: {
            btc: ['binance', 'coinbase', 'coingecko', 'yahoo-fallback'],
            fx: ['twelvedata', 'frankfurter', 'yahoo-fallback'],
            gold: ['twelvedata', 'yahoo-fallback'],
          },
          auth: 'worker-password-session-gate',
        });
      }

      if (url.pathname === '/api/notes') {
        return json({
          message:
            'این Worker حالا هم برای session/password gate آماده است و هم می‌تواند JSON داشبورد و preview آلارت‌ها را از cache جاری یا سایت فعلی تو سرو کند.',
          next: [
            'کد Worker فعلی را از Cloudflare Dashboard بردار و با این نسخه merge کن.',
            'SITE_ORIGIN را روی سایت فعلی یا نسخه build جدید تنظیم کن.',
            'SITE_PASSWORD و SESSION_SECRET را در Secrets بگذار.',
          ],
        });
      }

      if (url.pathname === '/api/login' && request.method === 'POST') {
        return handleLogin(request, env);
      }

      if (url.pathname === '/api/logout' && request.method === 'POST') {
        return handleLogout();
      }

      if (url.pathname === '/api/session') {
        return handleSession(request, env);
      }

      if (url.pathname.startsWith('/api/')) {
        const session = await requireSession(request, env);
        if (!session.ok) return json({ ok: false, error: 'Unauthorized' }, 401);

        if (url.pathname === '/api/dashboard') {
          const data = await loadDashboardData(env);
          return json({ ok: true, data, session: session.data }, 200, { 'cache-control': 'private, max-age=45' });
        }

        if (url.pathname === '/api/alerts/preview') {
          const data = await loadDashboardData(env);
          const preview = buildAlertFeed(data, Date.now());
          return json({ ok: true, ...preview });
        }

        return json({ error: 'Not found' }, 404);
      }

      return handleSiteRequest(request, env, url);
    } catch (error) {
      return json({ ok: false, error: error.message || 'Worker failure' }, 500);
    }
  },
};

async function handleLogin(request, env) {
  if (!env.SITE_PASSWORD) {
    return json({ ok: false, error: 'SITE_PASSWORD secret is missing' }, 500);
  }
  if (!env.SESSION_SECRET) {
    return json({ ok: false, error: 'SESSION_SECRET secret is missing' }, 500);
  }

  const body = await readJsonSafe(request);
  const password = String(body?.password || '');
  const next = sanitizeNext(body?.next || '/');

  if (!password || password !== env.SITE_PASSWORD) {
    return json({ ok: false, error: 'رمز عبور اشتباه است' }, 401);
  }

  const days = Number(env.SESSION_DAYS || DEFAULT_SESSION_DAYS) || DEFAULT_SESSION_DAYS;
  const token = await createSessionToken(
    {
      exp: Date.now() + days * 24 * 60 * 60 * 1000,
      next,
      ip: request.headers.get('cf-connecting-ip') || '',
      ua: request.headers.get('user-agent') || '',
    },
    env.SESSION_SECRET,
  );

  return json(
    { ok: true, next },
    200,
    {
      'set-cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 24 * 60 * 60}`,
      'cache-control': 'no-store',
    },
  );
}

function handleLogout() {
  return json(
    { ok: true },
    200,
    {
      'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      'cache-control': 'no-store',
    },
  );
}

async function handleSession(request, env) {
  const session = await requireSession(request, env);
  if (!session.ok) return json({ ok: false, authenticated: false }, 200);
  return json({ ok: true, authenticated: true, session: session.data }, 200);
}

async function handleSiteRequest(request, env, url) {
  const session = await requireSession(request, env);
  if (!session.ok) {
    return html(renderLoginPage(url.pathname + url.search, env.APP_NAME || 'FX Dashboard'));
  }

  const siteOrigin = env.SITE_ORIGIN?.replace(/\/$/, '');
  if (!siteOrigin) {
    return html(renderInfoPage('SITE_ORIGIN هنوز تنظیم نشده است. اول نسخه فعلی را پشت Worker قرار بده یا build جدید را deploy کن.'));
  }

  const currentOrigin = `${url.protocol}//${url.host}`.replace(/\/$/, '');
  if (siteOrigin === currentOrigin) {
    return html(renderInfoPage('SITE_ORIGIN نباید با خود Worker یکی باشد؛ وگرنه لوپ ایجاد می‌شود.'));
  }

  const target = new URL(url.pathname + url.search, `${siteOrigin}/`);
  const proxiedRequest = new Request(target.toString(), request);
  const response = await fetch(proxiedRequest, {
    cf: { cacheEverything: false },
  });
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, max-age=30');
  headers.delete('x-frame-options');
  return new Response(response.body, { status: response.status, headers });
}

async function loadDashboardData(env) {
  const explicit = env.DASHBOARD_JSON_URL?.trim();
  const fromOrigin = env.SITE_ORIGIN?.trim() ? `${env.SITE_ORIGIN.replace(/\/$/, '')}/data/prices.json` : '';
  const target = explicit || fromOrigin;
  if (!target) throw new Error('DASHBOARD_JSON_URL or SITE_ORIGIN must be configured');

  const response = await fetch(target, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 45, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Dashboard JSON fetch failed: ${response.status}`);
  const data = await response.json();
  if (!data.alerts || !Array.isArray(data.alerts)) {
    const generated = buildAlertFeed(data, Date.now());
    data.alerts = generated.items;
    data.alertSummary = generated.summary;
  }
  return data;
}

async function requireSession(request, env) {
  if (!env.SESSION_SECRET) return { ok: false };
  const token = parseCookies(request.headers.get('cookie') || '')[COOKIE_NAME];
  if (!token) return { ok: false };
  const payload = await verifySessionToken(token, env.SESSION_SECRET);
  if (!payload) return { ok: false };
  return { ok: true, data: { exp: payload.exp, next: payload.next || '/' } };
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(';').reduce((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) return acc;
    acc[rawKey] = rawValue.join('=');
    return acc;
  }, {});
}

async function createSessionToken(payload, secret) {
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signature = await signText(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifySessionToken(token, secret) {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = await signText(payload, secret);
  if (expected !== signature) return null;
  const data = JSON.parse(base64urlDecode(payload));
  if (!data?.exp || Number(data.exp) < Date.now()) return null;
  return data;
}

async function signText(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function base64urlEncode(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64urlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return binary;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function readJsonSafe(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function sanitizeNext(next = '/') {
  const value = String(next || '/');
  if (!value.startsWith('/')) return '/';
  return value;
}

function renderLoginPage(next, appName) {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(appName)} · ورود</title>
  <style>
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1020;color:#eef2ff;display:grid;place-items:center;min-height:100vh;padding:24px}
    .box{width:min(460px,100%);background:#11172a;border:1px solid #24314d;border-radius:20px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
    h1{margin:0 0 10px;font-size:24px} p{color:#b8c1d9;line-height:1.8} input{width:100%;box-sizing:border-box;padding:14px 16px;border-radius:12px;border:1px solid #344361;background:#0b1020;color:#fff;margin-top:12px} button{width:100%;margin-top:14px;padding:14px 16px;border-radius:12px;border:0;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer} .small{margin-top:12px;font-size:13px;color:#98a4c7} .error{color:#fca5a5;min-height:22px;margin-top:12px}
  </style>
</head>
<body>
  <div class="box">
    <h1>ورود به نسخه محافظت‌شده</h1>
    <p>این آدرس پشت Cloudflare Worker محافظت می‌شود. رمز مشترک خودت و دوست‌هایت را وارد کن.</p>
    <input id="password" type="password" placeholder="رمز عبور" autofocus />
    <button id="loginBtn">ورود</button>
    <div class="error" id="error"></div>
    <div class="small">بعد از ورود، سایت از origin اصلی proxy می‌شود و فقط از همین لینک بازش کن.</div>
  </div>
  <script>
    const next = ${JSON.stringify(next)};
    document.getElementById('loginBtn').addEventListener('click', async () => {
      const password = document.getElementById('password').value;
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, next }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        document.getElementById('error').textContent = data.error || 'ورود ناموفق بود';
        return;
      }
      location.href = next || '/';
    });
  </script>
</body>
</html>`;
}

function renderInfoPage(message) {
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#0b1020;color:#fff;padding:32px"><h1>FX Dashboard Worker</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
