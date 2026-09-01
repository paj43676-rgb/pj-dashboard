import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_PATH = path.resolve(process.cwd(), 'data/prices.json');
const STATE_PATH = path.resolve(process.cwd(), 'data/telegram-alert-state.json');
const MAX_ALERT_AGE_MS = 8 * 60 * 60 * 1000;
const KEEP_STATE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_LEVEL = process.env.ALERT_MIN_SEVERITY || 'warning';
const levelRank = { critical: 3, warning: 2, info: 1 };

function fa(value) {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function faDateTime(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('fa-IR', {
    weekday: 'short',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

function normalizeChats(raw = '') {
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function severityLabel(level) {
  return {
    critical: 'بحرانی',
    warning: 'هشدار',
    info: 'اطلاع',
  }[level] || 'اطلاع';
}

function buildMessage(alerts, payload) {
  const header = [
    '📡 هشدارهای جدید داشبورد',
    `بروزرسانی: ${faDateTime(payload.ts || Date.now())}`,
    `بحرانی: ${fa(payload.alertSummary?.critical || 0)} | هشدار: ${fa(payload.alertSummary?.warning || 0)} | اطلاع: ${fa(payload.alertSummary?.info || 0)}`,
    '',
  ];

  const lines = alerts.flatMap((alert, index) => {
    const assetLine = alert.assetIds?.length ? `نمادها: ${alert.assetIds.join(', ')}` : null;
    return [
      `${fa(index + 1)}) ${severityLabel(alert.severity)} | ${alert.title}`,
      alert.message,
      assetLine,
      `زمان: ${faDateTime(alert.eventTime || alert.createdAt || Date.now())}`,
      '',
    ].filter(Boolean);
  });

  const footer = [
    'لینک خصوصی سایت را از Cloudflare Worker باز کن.',
  ];

  return [...header, ...lines, ...footer].join('\n');
}

async function sendTelegramMessage(token, chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${response.status}`);
  }
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatIds = normalizeChats(process.env.TELEGRAM_CHAT_IDS || '');

  if (!token || !chatIds.length) {
    console.log('telegram-skip: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_IDS missing');
    return;
  }

  const payload = await readJson(DATA_PATH, null);
  if (!payload?.alerts?.length) {
    console.log('telegram-skip: no alerts in data/prices.json');
    return;
  }

  const state = await readJson(STATE_PATH, { sent: {} });
  const now = Date.now();
  const minRank = levelRank[MIN_LEVEL] || levelRank.warning;

  const candidates = payload.alerts
    .filter((alert) => levelRank[alert.severity] >= minRank)
    .filter((alert) => {
      const eventTime = Number(alert.eventTime || alert.createdAt || payload.ts || now);
      return Math.abs(now - eventTime) <= MAX_ALERT_AGE_MS;
    })
    .filter((alert) => !state.sent?.[alert.key])
    .slice(0, 5);

  if (!candidates.length) {
    console.log('telegram-skip: no new qualifying alerts');
    return;
  }

  const text = buildMessage(candidates, payload);
  for (const chatId of chatIds) {
    await sendTelegramMessage(token, chatId, text);
    console.log('telegram-sent', chatId, candidates.length);
  }

  const nextState = { sent: { ...(state.sent || {}) } };
  for (const [key, ts] of Object.entries(nextState.sent)) {
    if (now - Number(ts) > KEEP_STATE_MS) delete nextState.sent[key];
  }
  for (const alert of candidates) nextState.sent[alert.key] = now;

  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(nextState, null, 2));
  console.log('telegram-state-written', STATE_PATH);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
