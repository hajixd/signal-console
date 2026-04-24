import type { Bar } from "./types";

export type EnrichedBar = Bar & {
  ema9: number | null;
  ema12: number | null;
  ema21: number | null;
  ema34: number | null;
  ema30: number | null;
  ema50: number | null;
  ema200: number | null;
  atr14: number | null;
  atr100: number | null;
  rsi2: number | null;
  rsi14Centered: number | null;
  adx14: number | null;
  bbZ20: number | null;
  closeLocation: number | null;
  ret3Atr: number | null;
  ret6Atr: number | null;
  bodyAtr: number | null;
  sessionVwap: number | null;
  sessionStd: number | null;
  vwapZ: number | null;
  vwapSlopeAtr: number | null;
  nyDate: string;
  nyMinutes: number;
  nyWeekday: number;
  closeEma200Atr: number | null;
  bbWidthAtr: number | null;
  bbWidthPct200: number | null;
  priorHigh55: number | null;
};

function ema(values: number[], span: number): Array<number | null> {
  const alpha = 2 / (span + 1);
  const output: Array<number | null> = [];
  let current: number | null = null;
  for (const value of values) {
    current = current === null ? value : alpha * value + (1 - alpha) * current;
    output.push(current);
  }
  return output;
}

function rma(values: Array<number | null>, length: number): Array<number | null> {
  const output: Array<number | null> = [];
  let current: number | null = null;
  let seeded = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === null || Number.isNaN(value)) {
      output.push(null);
      continue;
    }
    if (!seeded) {
      const window = values.slice(Math.max(0, index - length + 1), index + 1).filter((item): item is number => item !== null);
      if (window.length < length) {
        output.push(null);
        continue;
      }
      current = window.reduce((sum, item) => sum + item, 0) / length;
      seeded = true;
    } else {
      current = ((current ?? value) * (length - 1) + value) / length;
    }
    output.push(current);
  }
  return output;
}

function rollingStd(values: number[], length: number): Array<number | null> {
  return values.map((_, index) => {
    if (index + 1 < length) return null;
    const window = values.slice(index - length + 1, index + 1);
    const mean = window.reduce((sum, item) => sum + item, 0) / length;
    const variance = window.reduce((sum, item) => sum + (item - mean) ** 2, 0) / length;
    return Math.sqrt(variance);
  });
}

function rollingMean(values: number[], length: number): Array<number | null> {
  return values.map((_, index) => {
    if (index + 1 < length) return null;
    const window = values.slice(index - length + 1, index + 1);
    return window.reduce((sum, item) => sum + item, 0) / length;
  });
}

function percentileRanks(values: Array<number | null>, length: number): Array<number | null> {
  return values.map((value, index) => {
    if (value === null || index + 1 < length) return null;
    const window = values.slice(index - length + 1, index + 1).filter((item): item is number => item !== null);
    if (window.length < length) return null;
    const belowOrEqual = window.filter((item) => item <= value).length;
    return belowOrEqual / window.length;
  });
}

const NEW_YORK_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short"
});

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
};

function newYorkMeta(value: string): { date: string; minutes: number; weekday: number } {
  const parts = NEW_YORK_PARTS.formatToParts(new Date(value));
  const record = new Map(parts.map((part) => [part.type, part.value]));
  const year = record.get("year") ?? "1970";
  const month = record.get("month") ?? "01";
  const day = record.get("day") ?? "01";
  const hour = record.get("hour") ?? "00";
  const minute = record.get("minute") ?? "00";
  const weekday = record.get("weekday") ?? "Mon";
  const normalizedHour = hour === "24" ? 0 : Number(hour);
  return {
    date: `${year}-${month}-${day}`,
    minutes: normalizedHour * 60 + Number(minute),
    weekday: WEEKDAY_INDEX[weekday] ?? 0
  };
}

export function enrichBars(bars: Bar[]): EnrichedBar[] {
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const opens = bars.map((bar) => bar.open);
  const typicals = bars.map((bar) => (bar.high + bar.low + bar.close) / 3);
  const nyMeta = bars.map((bar) => newYorkMeta(bar.time));
  const ema9 = ema(closes, 9);
  const ema12 = ema(closes, 12);
  const ema21 = ema(closes, 21);
  const ema34 = ema(closes, 34);
  const ema30 = ema(closes, 30);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  const trueRange = bars.map((bar, index) => {
    if (index === 0) return bar.high - bar.low;
    const prevClose = bars[index - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  });
  const atr14 = rma(trueRange, 14);
  const atr100 = rma(trueRange, 100);

  const deltas = closes.map((close, index) => (index === 0 ? 0 : close - closes[index - 1]));
  const gains = deltas.map((delta) => Math.max(delta, 0));
  const losses = deltas.map((delta) => Math.max(-delta, 0));
  const avgGain2 = rma(gains, 2);
  const avgLoss2 = rma(losses, 2);
  const avgGain = rma(gains, 14);
  const avgLoss = rma(losses, 14);
  const rsi2 = avgGain2.map((gain, index) => {
    const loss = avgLoss2[index];
    if (gain === null || loss === null) return null;
    if (loss === 0) return 100;
    return 100 - 100 / (1 + gain / loss);
  });
  const rsi14Centered = avgGain.map((gain, index) => {
    const loss = avgLoss[index];
    if (gain === null || loss === null) return null;
    if (loss === 0) return 1;
    const rsi = 100 - 100 / (1 + gain / loss);
    return (rsi - 50) / 50;
  });

  const upMove = highs.map((high, index) => (index === 0 ? 0 : high - highs[index - 1]));
  const downMove = lows.map((low, index) => (index === 0 ? 0 : lows[index - 1] - low));
  const plusDm = upMove.map((move, index) => (move > downMove[index] && move > 0 ? move : 0));
  const minusDm = downMove.map((move, index) => (move > upMove[index] && move > 0 ? move : 0));
  const plusDi = rma(plusDm, 14).map((value, index) => {
    const atr = atr14[index];
    if (value === null || atr === null || atr === 0) return null;
    return (100 * value) / atr;
  });
  const minusDi = rma(minusDm, 14).map((value, index) => {
    const atr = atr14[index];
    if (value === null || atr === null || atr === 0) return null;
    return (100 * value) / atr;
  });
  const dx = plusDi.map((value, index) => {
    const minus = minusDi[index];
    if (value === null || minus === null) return null;
    const denominator = value + minus;
    if (denominator === 0) return null;
    return (100 * Math.abs(value - minus)) / denominator;
  });
  const adx14 = rma(dx, 14);

  const sma20 = rollingMean(closes, 20);
  const std20 = rollingStd(closes, 20);
  const bbZ20 = closes.map((close, index) => {
    const mean = sma20[index];
    const std = std20[index];
    if (mean === null || std === null || std === 0) return null;
    return (close - mean) / std;
  });
  const bbWidthAtr = std20.map((std, index) => {
    const atr = atr100[index];
    if (std === null || atr === null || atr === 0) return null;
    return (4 * std) / atr;
  });
  const bbWidthPct200 = percentileRanks(bbWidthAtr, 200);

  const closeLocation = bars.map((bar) => {
    const range = bar.high - bar.low;
    return range === 0 ? 0.5 : (bar.close - bar.low) / range;
  });
  const ret3Atr = closes.map((close, index) => {
    const atr = atr14[index];
    if (index < 3 || atr === null || atr === 0) return null;
    return (close - closes[index - 3]) / atr;
  });
  const ret6Atr = closes.map((close, index) => {
    const atr = atr14[index];
    if (index < 6 || atr === null || atr === 0) return null;
    return (close - closes[index - 6]) / atr;
  });
  const bodyAtr = closes.map((close, index) => {
    const atr = atr14[index];
    if (atr === null || atr === 0) return null;
    return (close - opens[index]) / atr;
  });

  const sessionVwap: Array<number | null> = [];
  const sessionStd: Array<number | null> = [];
  let currentDate = "";
  let cumulativeCount = 0;
  let cumulativeTypical = 0;
  let cumulativeTypicalSq = 0;
  for (let index = 0; index < bars.length; index += 1) {
    if (nyMeta[index]!.date !== currentDate) {
      currentDate = nyMeta[index]!.date;
      cumulativeCount = 0;
      cumulativeTypical = 0;
      cumulativeTypicalSq = 0;
    }
    const typical = typicals[index]!;
    cumulativeCount += 1;
    cumulativeTypical += typical;
    cumulativeTypicalSq += typical * typical;
    const vwap = cumulativeTypical / cumulativeCount;
    const variance = Math.max(0, cumulativeTypicalSq / cumulativeCount - vwap * vwap);
    sessionVwap.push(vwap);
    sessionStd.push(variance > 0 ? Math.sqrt(variance) : null);
  }
  const vwapZ = closes.map((close, index) => {
    const vwap = sessionVwap[index];
    const std = sessionStd[index];
    if (vwap === null || std === null || std === 0) return 0;
    return (close - vwap) / std;
  });
  const vwapSlopeAtr = sessionVwap.map((vwap, index) => {
    const atr = atr14[index];
    const prior = index >= 4 ? sessionVwap[index - 4] : null;
    if (vwap === null || prior === null || atr === null || atr === 0) return 0;
    return (vwap - prior) / atr;
  });

  return bars.map((bar, index) => {
    const atr = atr100[index];
    const e200 = ema200[index];
    const closeEma200Atr = atr && e200 !== null ? (bar.close - e200) / atr : null;
    const priorWindow = highs.slice(Math.max(0, index - 55), index);
    return {
      ...bar,
      ema9: ema9[index],
      ema12: ema12[index],
      ema21: ema21[index],
      ema34: ema34[index],
      ema30: ema30[index],
      ema50: ema50[index],
      ema200: e200,
      atr14: atr14[index],
      atr100: atr,
      rsi2: rsi2[index],
      rsi14Centered: rsi14Centered[index],
      adx14: adx14[index],
      bbZ20: bbZ20[index],
      closeLocation: closeLocation[index],
      ret3Atr: ret3Atr[index],
      ret6Atr: ret6Atr[index],
      bodyAtr: bodyAtr[index],
      sessionVwap: sessionVwap[index],
      sessionStd: sessionStd[index],
      vwapZ: vwapZ[index],
      vwapSlopeAtr: vwapSlopeAtr[index],
      nyDate: nyMeta[index]!.date,
      nyMinutes: nyMeta[index]!.minutes,
      nyWeekday: nyMeta[index]!.weekday,
      closeEma200Atr,
      bbWidthAtr: bbWidthAtr[index],
      bbWidthPct200: bbWidthPct200[index],
      priorHigh55: priorWindow.length >= 55 ? Math.max(...priorWindow) : null
    };
  });
}
