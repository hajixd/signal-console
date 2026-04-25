import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { StrategyRule } from "@/lib/types";
import { roundToTick } from "./helpers";

type AggregatedBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  startTimeMs: number;
  endSourceIndex: number;
};

function variantNumber(variantId: string | undefined, key: string, fallback: number): number {
  if (!variantId) return fallback;
  for (const token of variantId.split("|")) {
    const [tokenKey, tokenValue] = token.split("=", 2);
    if (tokenKey !== key || tokenValue === undefined || tokenValue === "") continue;
    const parsed = Number(tokenValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function aggregateBars(bars: EnrichedBar[], intervalMs: number): AggregatedBar[] {
  const output: AggregatedBar[] = [];
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index]!;
    const timeMs = Date.parse(bar.time);
    if (!Number.isFinite(timeMs)) continue;
    const bucketStart = Math.floor(timeMs / intervalMs) * intervalMs;
    const current = output[output.length - 1];
    if (!current || current.startTimeMs !== bucketStart) {
      output.push({
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        startTimeMs: bucketStart,
        endSourceIndex: index
      });
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.endSourceIndex = index;
  }
  return output;
}

function ema(values: number[], span: number): number[] {
  const output: number[] = [];
  const alpha = 2 / (span + 1);
  let current = values[0] ?? 0;
  for (const value of values) {
    current = output.length === 0 ? value : alpha * value + (1 - alpha) * current;
    output.push(current);
  }
  return output;
}

function rma(values: number[], length: number): Array<number | null> {
  const output: Array<number | null> = Array(values.length).fill(null);
  if (values.length < length) return output;
  let current = values.slice(0, length).reduce((sum, item) => sum + item, 0) / length;
  output[length - 1] = current;
  for (let index = length; index < values.length; index += 1) {
    current = ((current * (length - 1)) + values[index]!) / length;
    output[index] = current;
  }
  return output;
}

function atr(bars: AggregatedBar[], length: number): Array<number | null> {
  const trueRange = bars.map((bar, index) => {
    if (index === 0) return bar.high - bar.low;
    const prevClose = bars[index - 1]!.close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  });
  return rma(trueRange, length);
}

function pivotFlags(bars: AggregatedBar[], swing: number): { highs: boolean[]; lows: boolean[] } {
  const highs = Array<boolean>(bars.length).fill(false);
  const lows = Array<boolean>(bars.length).fill(false);
  for (let index = swing; index < bars.length - swing; index += 1) {
    const bar = bars[index]!;
    const left = bars.slice(index - swing, index);
    const right = bars.slice(index + 1, index + swing + 1);
    highs[index] = left.every((item) => bar.high > item.high) && right.every((item) => bar.high >= item.high);
    lows[index] = left.every((item) => bar.low < item.low) && right.every((item) => bar.low <= item.low);
  }
  return { highs, lows };
}

function trendlineValue(indexA: number, priceA: number, indexB: number, priceB: number, targetIndex: number): number {
  if (indexB === indexA) return priceB;
  return priceA + (priceB - priceA) * ((targetIndex - indexA) / (indexB - indexA));
}

function selectDescending(indices: number[], prices: number[], touches: number, minGap: number): number[] {
  const selected: number[] = [];
  let lastPrice = Number.POSITIVE_INFINITY;
  let lastIndex = Number.POSITIVE_INFINITY;
  for (let cursor = indices.length - 1; cursor >= 0; cursor -= 1) {
    const index = indices[cursor]!;
    const price = prices[index]!;
    if (price < lastPrice && (selected.length === 0 || lastIndex - index >= minGap)) {
      selected.push(index);
      lastPrice = price;
      lastIndex = index;
      if (selected.length === touches) break;
    }
  }
  return selected.length === touches ? selected.reverse() : [];
}

function selectAscending(indices: number[], prices: number[], touches: number, minGap: number): number[] {
  const selected: number[] = [];
  let lastPrice = Number.NEGATIVE_INFINITY;
  let lastIndex = Number.POSITIVE_INFINITY;
  for (let cursor = indices.length - 1; cursor >= 0; cursor -= 1) {
    const index = indices[cursor]!;
    const price = prices[index]!;
    if (price > lastPrice && (selected.length === 0 || lastIndex - index >= minGap)) {
      selected.push(index);
      lastPrice = price;
      lastIndex = index;
      if (selected.length === touches) break;
    }
  }
  return selected.length === touches ? selected.reverse() : [];
}

function touchesNearLine(indices: number[], prices: number[], atrValues: Array<number | null>, toleranceMult: number): boolean {
  if (indices.length < 2) return false;
  const first = indices[0]!;
  const last = indices[indices.length - 1]!;
  const firstPrice = prices[first]!;
  const lastPrice = prices[last]!;
  for (const index of indices.slice(1, -1)) {
    const atrValue = atrValues[index];
    if (atrValue === null || !Number.isFinite(atrValue)) return false;
    const expected = trendlineValue(first, firstPrice, last, lastPrice, index);
    if (Math.abs(prices[index]! - expected) > atrValue * toleranceMult) return false;
  }
  return true;
}

function priorCompletedDailyIndex(dailyBars: AggregatedBar[], currentTimeMs: number): number {
  const currentDayStart = currentTimeMs - (currentTimeMs % 86_400_000);
  for (let index = dailyBars.length - 1; index >= 0; index -= 1) {
    if (dailyBars[index]!.startTimeMs < currentDayStart) return index;
  }
  return -1;
}

function toriConfidence(ema50: number, ema200: number, atrValue: number, riskAtr: number, touches: number): number {
  const trendStrength = atrValue > 0 ? Math.min(Math.abs(ema50 - ema200) / atrValue, 2) / 2 : 0;
  let confidence = 0.45;
  confidence += touches >= 3 ? 0.12 : 0.07;
  confidence += Math.max(0, 0.18 - Math.max(0, riskAtr - 1.5) * 0.08);
  confidence += trendStrength * 0.18;
  return Math.max(0.35, Math.min(confidence, 0.92));
}

export function evaluateToriTrendlineMtf(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number): StrategySignal | null {
  const signalBar = bars[signalIndex];
  if (!signalBar) return null;

  const signalTimeMs = Date.parse(signalBar.time);
  if (!Number.isFinite(signalTimeMs) || signalTimeMs % 3_600_000 !== 2_700_000) return null;

  const swing = Math.max(1, Math.min(2, Math.round(variantNumber(rule.variantId, "swing", 2))));
  const lookback = Math.max(12, Math.round(variantNumber(rule.variantId, "lookback", 24)));
  const touchCount = Math.max(2, Math.round(variantNumber(rule.variantId, "touch", 2)));
  const minGap = Math.max(1, Math.round(variantNumber(rule.variantId, "gap", 1)));
  const leadBars = Math.max(1, Math.round(variantNumber(rule.variantId, "lead", 4)));
  const targetLookback = Math.max(12, Math.round(variantNumber(rule.variantId, "target_lookback", 48)));
  const breakBuffer = Math.max(0, variantNumber(rule.variantId, "break", 0.02));
  const tolerance = Math.max(0.05, variantNumber(rule.variantId, "tol", 0.3));
  const stopBuffer = Math.max(0, variantNumber(rule.variantId, "stop_buf", 0.1));
  const rewardMultiple = Math.max(1, variantNumber(rule.variantId, "rr", 2));
  const maxRiskAtr = Math.max(0.5, variantNumber(rule.variantId, "risk", 3));

  const hourlyBars = aggregateBars(bars.slice(0, signalIndex + 1), 3_600_000);
  const dailyBars = aggregateBars(bars.slice(0, signalIndex + 1), 86_400_000);
  if (!hourlyBars.length || !dailyBars.length) return null;

  const hourIndex = hourlyBars.length - 1;
  if (hourlyBars[hourIndex]!.endSourceIndex !== signalIndex) return null;

  const dailyIndex = priorCompletedDailyIndex(dailyBars, signalTimeMs);
  if (dailyIndex < 60) return null;

  const hourlyClose = hourlyBars.map((bar) => bar.close);
  const dailyClose = dailyBars.map((bar) => bar.close);
  const hourlyAtr = atr(hourlyBars, 14);
  const hourlyEma21 = ema(hourlyClose, 21);
  const hourlyEma50 = ema(hourlyClose, 50);
  const hourlyEma200 = ema(hourlyClose, 200);
  const dailyEma20 = ema(dailyClose, 20);
  const dailyEma50 = ema(dailyClose, 50);
  const { highs: pivotHigh, lows: pivotLow } = pivotFlags(hourlyBars, swing);
  const atrValue = hourlyAtr[hourIndex];
  if (atrValue === null || !Number.isFinite(atrValue) || atrValue <= 0) return null;

  const macroUp =
    dailyClose[dailyIndex]! > dailyEma20[dailyIndex]! &&
    dailyEma20[dailyIndex]! > dailyEma50[dailyIndex]! &&
    hourlyEma21[hourIndex]! > hourlyEma50[hourIndex]! &&
    hourlyEma50[hourIndex]! > hourlyEma200[hourIndex]!;
  const macroDown =
    dailyClose[dailyIndex]! < dailyEma20[dailyIndex]! &&
    dailyEma20[dailyIndex]! < dailyEma50[dailyIndex]! &&
    hourlyEma21[hourIndex]! < hourlyEma50[hourIndex]! &&
    hourlyEma50[hourIndex]! < hourlyEma200[hourIndex]!;
  if (!macroUp && !macroDown) return null;

  const confirmedLimit = hourIndex - swing;
  const windowStart = Math.max(0, hourIndex - lookback);
  if (confirmedLimit <= windowStart) return null;

  const highIndices = [];
  const lowIndices = [];
  for (let cursor = windowStart; cursor <= confirmedLimit; cursor += 1) {
    if (pivotHigh[cursor]) highIndices.push(cursor);
    if (pivotLow[cursor]) lowIndices.push(cursor);
  }
  if (highIndices.length < touchCount || lowIndices.length < 2) return null;

  let side: "long" | "short" | null = null;
  let actionIndices: number[] = [];
  let safetyIndices: number[] = [];
  let actionNow = 0;
  let safetyNow = 0;

  if (macroUp) {
    actionIndices = selectDescending(highIndices, hourlyBars.map((bar) => bar.high), touchCount, minGap);
    safetyIndices = selectDescending(lowIndices, hourlyBars.map((bar) => bar.low), 2, minGap);
    if (
      actionIndices.length &&
      safetyIndices.length &&
      actionIndices[0]! < safetyIndices[0]! &&
      safetyIndices[0]! < actionIndices[actionIndices.length - 1]! &&
      touchesNearLine(actionIndices, hourlyBars.map((bar) => bar.high), hourlyAtr, tolerance) &&
      touchesNearLine(safetyIndices, hourlyBars.map((bar) => bar.low), hourlyAtr, tolerance)
    ) {
      actionNow = trendlineValue(
        actionIndices[0]!,
        hourlyBars[actionIndices[0]!]!.high,
        actionIndices[actionIndices.length - 1]!,
        hourlyBars[actionIndices[actionIndices.length - 1]!]!.high,
        hourIndex
      );
      const actionPrev = trendlineValue(
        actionIndices[0]!,
        hourlyBars[actionIndices[0]!]!.high,
        actionIndices[actionIndices.length - 1]!,
        hourlyBars[actionIndices[actionIndices.length - 1]!]!.high,
        hourIndex - 1
      );
      safetyNow = trendlineValue(
        safetyIndices[0]!,
        hourlyBars[safetyIndices[0]!]!.low,
        safetyIndices[safetyIndices.length - 1]!,
        hourlyBars[safetyIndices[safetyIndices.length - 1]!]!.low,
        hourIndex + leadBars
      );
      if (
        hourlyBars[hourIndex - 1]!.close <= actionPrev &&
        hourlyBars[hourIndex]!.close > actionNow + atrValue * breakBuffer &&
        actionNow - safetyNow > atrValue * 0.2
      ) {
        side = "long";
      }
    }
  }

  if (macroDown && !side) {
    actionIndices = selectAscending(lowIndices, hourlyBars.map((bar) => bar.low), touchCount, minGap);
    safetyIndices = selectAscending(highIndices, hourlyBars.map((bar) => bar.high), 2, minGap);
    if (
      actionIndices.length &&
      safetyIndices.length &&
      actionIndices[0]! < safetyIndices[0]! &&
      safetyIndices[0]! < actionIndices[actionIndices.length - 1]! &&
      touchesNearLine(actionIndices, hourlyBars.map((bar) => bar.low), hourlyAtr, tolerance) &&
      touchesNearLine(safetyIndices, hourlyBars.map((bar) => bar.high), hourlyAtr, tolerance)
    ) {
      actionNow = trendlineValue(
        actionIndices[0]!,
        hourlyBars[actionIndices[0]!]!.low,
        actionIndices[actionIndices.length - 1]!,
        hourlyBars[actionIndices[actionIndices.length - 1]!]!.low,
        hourIndex
      );
      const actionPrev = trendlineValue(
        actionIndices[0]!,
        hourlyBars[actionIndices[0]!]!.low,
        actionIndices[actionIndices.length - 1]!,
        hourlyBars[actionIndices[actionIndices.length - 1]!]!.low,
        hourIndex - 1
      );
      safetyNow = trendlineValue(
        safetyIndices[0]!,
        hourlyBars[safetyIndices[0]!]!.high,
        safetyIndices[safetyIndices.length - 1]!,
        hourlyBars[safetyIndices[safetyIndices.length - 1]!]!.high,
        hourIndex + leadBars
      );
      if (
        hourlyBars[hourIndex - 1]!.close >= actionPrev &&
        hourlyBars[hourIndex]!.close < actionNow - atrValue * breakBuffer &&
        safetyNow - actionNow > atrValue * 0.2
      ) {
        side = "short";
      }
    }
  }

  if (!side) return null;

  const referenceEntry = signalBar.close;
  const stopLossPrice =
    side === "long" ? roundToTick(safetyNow - atrValue * stopBuffer, rule.tickSize) : roundToTick(safetyNow + atrValue * stopBuffer, rule.tickSize);
  const risk = Math.abs(referenceEntry - stopLossPrice);
  if (!Number.isFinite(risk) || risk <= 0 || risk > atrValue * maxRiskAtr) return null;

  const structureStart = Math.max(0, actionIndices[0]! - targetLookback);
  const takeProfitPrice =
    side === "long"
      ? roundToTick(
          Math.max(referenceEntry + risk * rewardMultiple, Math.max(...hourlyBars.slice(structureStart, actionIndices[0]! + 1).map((bar) => bar.high))),
          rule.tickSize
        )
      : roundToTick(
          Math.min(referenceEntry - risk * rewardMultiple, Math.min(...hourlyBars.slice(structureStart, actionIndices[0]! + 1).map((bar) => bar.low))),
          rule.tickSize
        );
  if (side === "long" ? takeProfitPrice <= referenceEntry : takeProfitPrice >= referenceEntry) return null;

  return {
    side,
    entryPrice: roundToTick(referenceEntry, rule.tickSize),
    takeProfitPrice,
    stopLossPrice,
    tpUnits: Math.abs(takeProfitPrice - referenceEntry) / rule.tickSize,
    slUnits: Math.abs(referenceEntry - stopLossPrice) / rule.tickSize,
    signalTime: signalBar.time,
    entryType: "market",
    stopLossMode: "price",
    takeProfitMode: "price",
    confidence: toriConfidence(hourlyEma50[hourIndex]!, hourlyEma200[hourIndex]!, atrValue, risk / atrValue, touchCount),
    notes:
      "Tori MTF proxy: prior-day trend filter, hourly action/safety lines, and next-15m execution after the hourly break."
  };
}
