import { buildAlertFeed } from '../../shared/market-intel.js';

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

