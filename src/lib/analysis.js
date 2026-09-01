export function smaAt(values, index, period) {
  if (index < period - 1) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += values[i];
  return sum / period;
}

export function stdevAt(values, index, period) {
  const mean = smaAt(values, index, period);
  if (mean == null) return null;
  let total = 0;
  for (let i = index - period + 1; i <= index; i += 1) {
    total += (values[i] - mean) ** 2;
  }
  return Math.sqrt(total / period);
}

export function ema(values, period) {
  const factor = 2 / (period + 1);
  let current = values[0] ?? 0;
  return values.map((value, index) => {
    current = index === 0 ? value : value * factor + current * (1 - factor);
    return current;
  });
}

export function rsiAt(values, index, period = 14) {
  if (index < period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = index - period + 1; i <= index; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) gain += delta;
    else loss -= delta;
  }
  if (!loss) return 100;
  const rs = gain / period / (loss / period);
  return 100 - 100 / (1 + rs);
}

export function macd(values) {
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);
  const line = values.map((_, index) => e12[index] - e26[index]);
  const signal = ema(line, 9);
  const hist = line.map((value, index) => value - signal[index]);
  return { line, signal, hist };
}

export function atr(values, period = 14) {
  if (values.length < period + 1) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    sum += Math.abs(values[i] - values[i - 1]);
  }
  return sum / period;
}

export function supportResistance(values) {
  const recent = values.slice(-30);
  const last = values.at(-1);
  const high = Math.max(...recent);
  const low = Math.min(...recent);
  const pivot = (high + low + last) / 3;
  return {
    low,
    s1: 2 * pivot - high,
    pivot,
    r1: 2 * pivot - low,
    high,
  };
}

export function analyze(values) {
  if (!values || values.length < 14) return null;
  const rsi = rsiAt(values, values.length - 1) ?? 50;
  const macdPack = macd(values);
  const hist = macdPack.hist.at(-1) ?? 0;
  const prevHist = macdPack.hist.at(-2) ?? hist;
  const s7 = smaAt(values, values.length - 1, 7) ?? values.at(-1);
  const s21 = smaAt(values, values.length - 1, 21) ?? values.at(-1);
  let score = 50;
  if (values.at(-1) > s21) score += 10;
  else score -= 10;
  if (values.at(-1) > s7) score += 8;
  else score -= 8;
  if (s7 > s21) score += 10;
  else score -= 10;
  if (hist > 0) score += 8;
  else score -= 8;
  if (hist > prevHist) score += 4;
  else score -= 4;
  if (rsi >= 70) score -= 6;
  else if (rsi <= 30) score += 6;
  else if (rsi > 55) score += 5;
  else if (rsi < 45) score -= 5;
  score = Math.max(5, Math.min(95, Math.round(score)));

  const label =
    rsi >= 70
      ? 'اشباع خرید'
      : rsi <= 30
        ? 'اشباع فروش'
        : score >= 66
          ? 'صعودی قوی'
          : score >= 56
            ? 'صعودی'
            : score > 44
              ? 'خنثی'
              : score > 34
                ? 'نزولی'
                : 'نزولی قوی';

  const tone =
    score >= 56 ? 'up' : score > 44 ? 'warn' : 'down';

  return {
    score,
    label,
    tone,
    rsi,
    macd: macdPack,
    atr: atr(values) ?? Math.abs(values.at(-1)) * 0.01,
    sr: supportResistance(values),
  };
}

export function buildSetup(values, newsScore = 50, eventPenalty = 0, horizon = 1.2) {
  const core = analyze(values);
  if (!core) return null;
  const last = values.at(-1);
  const combo = Math.max(5, Math.min(95, Math.round(core.score * 0.72 + newsScore * 0.28 - eventPenalty)));
  const isBuy = combo >= 62;
  const isSell = combo <= 38;

  const support = core.sr.s1;
  const pivot = core.sr.pivot;
  const resistance = core.sr.r1;
  const atrValue = core.atr;

  let entryLow = last;
  let entryHigh = last;
  let stop = last;
  let target1 = last;
  let target2 = last;
  let side = 'wait';
  let title = 'صبر / مشاهده';
  let note = 'ترکیب داده‌ها هنوز ستاپ مطمئن نداده؛ بهتر است شکست یا پولبک واضح‌تری صبر شود.';

  if (isBuy) {
    side = 'buy';
    title = 'خرید روی پولبک';
    entryLow = Math.max(support, last - atrValue * (0.55 + horizon * 0.12));
    entryHigh = Math.max(entryLow, Math.min(last, pivot));
    stop = Math.min(entryLow - atrValue * 0.9, support - atrValue * 0.35);
    target1 = Math.max(resistance, last + atrValue * horizon * 0.85);
    target2 = Math.max(target1 + atrValue * 0.45, last + atrValue * horizon * 1.55);
    note = 'ورود بهتر است بعد از حفظ پیوت یا پولبک کنترل‌شده انجام شود. نزدیک خبرهای مهم حجم معامله کمتر باشد.';
  }

  if (isSell) {
    side = 'sell';
    title = 'فروش روی برگشت';
    entryLow = Math.min(Math.max(last, pivot), resistance);
    entryHigh = Math.max(entryLow, Math.max(last + atrValue * (0.55 + horizon * 0.12), resistance * 0.998));
    stop = Math.max(entryHigh + atrValue * 0.9, resistance + atrValue * 0.35);
    target1 = Math.min(support, last - atrValue * horizon * 0.85);
    target2 = Math.min(target1 - atrValue * 0.45, last - atrValue * horizon * 1.55);
    note = 'اگر قیمت پس از برگشت به مقاومت ضعف نشان دهد، ستاپ فروش معتبرتر می‌شود. هنگام خبرهای پرریسک محتاط باش.';
  }

  const entryMid = (entryLow + entryHigh) / 2;
  const risk = Math.abs(entryMid - stop) || 1;
  const reward1 = Math.abs(target1 - entryMid);
  const reward2 = Math.abs(target2 - entryMid);

  return {
    ...core,
    combo,
    title,
    side,
    entryLow,
    entryHigh,
    stop,
    target1,
    target2,
    rr1: reward1 / risk,
    rr2: reward2 / risk,
    note,
  };
}
