export const fa = (value) =>
  String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

export function fmt(value, decimals = 2) {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function ago(input) {
  const time = input instanceof Date ? input.getTime() : Number(input);
  const seconds = Math.max(1, Math.floor((Date.now() - time) / 1000));
  if (seconds < 90) return 'همین حالا';
  if (seconds < 3600) return `${fa(Math.floor(seconds / 60))} دقیقه پیش`;
  if (seconds < 86400) return `${fa(Math.floor(seconds / 3600))} ساعت پیش`;
  return `${fa(Math.floor(seconds / 86400))} روز پیش`;
}

export function faDateTime(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('fa-IR', {
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
