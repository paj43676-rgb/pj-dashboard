const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const TEHRAN_TZ = 'Asia/Tehran';

export const fa = (value) => String(value).replace(/\d/g, (digit) => FA_DIGITS[Number(digit)]);

export function fmt(value, decimals = 2) {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function ago(input, now = Date.now()) {
  const time = input instanceof Date ? input.getTime() : Number(input);
  const seconds = Math.max(1, Math.floor((now - time) / 1000));
  if (seconds < 90) return 'همین حالا';
  if (seconds < 3600) return `${fa(Math.floor(seconds / 60))} دقیقه پیش`;
  if (seconds < 86400) return `${fa(Math.floor(seconds / 3600))} ساعت پیش`;
  return `${fa(Math.floor(seconds / 86400))} روز پیش`;
}

export function timeUntil(input, now = Date.now()) {
  const time = input instanceof Date ? input.getTime() : Number(input);
  if (!Number.isFinite(time)) return '—';
  const diff = Math.round((time - now) / 60000);
  if (Math.abs(diff) < 1) return 'همین حالا';
  if (diff < 0) return `${fa(Math.abs(diff))} دقیقه قبل`;
  if (diff < 60) return `${fa(diff)} دقیقه دیگر`;
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return minutes ? `${fa(hours)} ساعت و ${fa(minutes)} دقیقه دیگر` : `${fa(hours)} ساعت دیگر`;
}

export function faDateTime(input, options = {}) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-gregory', {
    timeZone: TEHRAN_TZ,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...options,
  }).format(date);
}

export function faClock(input = Date.now()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR-u-ca-gregory', {
    timeZone: TEHRAN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function stalenessText(input, now = Date.now()) {
  const time = input instanceof Date ? input.getTime() : Number(input);
  if (!Number.isFinite(time)) return 'نامشخص';
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  if (minutes <= 1) return 'تقریباً زنده';
  if (minutes < 60) return `${fa(minutes)} دقیقه از آخرین داده گذشته`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${fa(hours)} ساعت و ${fa(remain)} دقیقه از آخرین داده گذشته` : `${fa(hours)} ساعت از آخرین داده گذشته`;
}
