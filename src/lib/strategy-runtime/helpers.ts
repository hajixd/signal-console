import type { EnrichedBar } from "@/lib/indicators";
import type { Side } from "@/lib/types";
import { LONG, SESSION_OPEN_ET, SHORT } from "./constants";
import type { SignalConsoleStrategyConfig, StrategyTrend } from "./runtime-config";

export function roundToTick(value: number, tickSize: number): number {
  return Math.round(value / tickSize) * tickSize;
}

export function allowedByTrend(bar: EnrichedBar, side: Side, trend: StrategyTrend): boolean {
  if (trend === "all" || trend === "both") return true;
  if (trend === "long_only") return side === LONG;
  if (trend === "short_only") return side === SHORT;
  if (trend !== "ema") return true;
  if (bar.ema30 === null || bar.ema200 === null) return false;
  return side === LONG ? bar.ema30 > bar.ema200 : bar.ema30 < bar.ema200;
}

export function sessionMinutes(config: SignalConsoleStrategyConfig): { start: number; end: number } {
  if (config.session === "all") {
    return { start: 7 * 60, end: 15 * 60 + 30 };
  }
  const openMinutes = SESSION_OPEN_ET[config.session];
  return {
    start: openMinutes,
    end: Math.min(openMinutes + Math.max(60, config.entryMinutes), 15 * 60 + 30)
  };
}

export function priorDayRange(bars: EnrichedBar[], index: number): { high: number; low: number } | null {
  const currentDay = bars[index]?.nyDate;
  if (!currentDay) return null;

  let priorDay = "";
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const day = bars[cursor]?.nyDate;
    if (day && day !== currentDay) {
      priorDay = day;
      break;
    }
  }
  if (!priorDay) return null;

  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const bar = bars[cursor]!;
    if (bar.nyDate !== priorDay) {
      if (high > Number.NEGATIVE_INFINITY && low < Number.POSITIVE_INFINITY) break;
      continue;
    }
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
  }

  return Number.isFinite(high) && Number.isFinite(low) ? { high, low } : null;
}

export function orbWindowForLatest(
  bars: EnrichedBar[],
  signalIndex: number,
  config: SignalConsoleStrategyConfig
): { rangeStart: number; rangeEnd: number; entryStart: number; entryEnd: number } | null {
  const signalBar = bars[signalIndex];
  if (!signalBar || config.session === "all") return null;

  const openMinutes = SESSION_OPEN_ET[config.session];
  const rangeEndMinutes = openMinutes + config.rangeMinutes;
  const entryEndMinutes = rangeEndMinutes + config.entryMinutes;
  if (signalBar.nyMinutes < rangeEndMinutes || signalBar.nyMinutes > entryEndMinutes) return null;

  const dayIndices = bars
    .map((bar, index) => ({ bar, index }))
    .filter((item) => item.bar.nyDate === signalBar.nyDate)
    .map((item) => item.index);
  const rangeIndices = dayIndices.filter((index) => bars[index]!.nyMinutes >= openMinutes && bars[index]!.nyMinutes < rangeEndMinutes);
  const entryIndices = dayIndices.filter(
    (index) => bars[index]!.nyMinutes >= rangeEndMinutes && bars[index]!.nyMinutes <= entryEndMinutes
  );
  if (!rangeIndices.length || !entryIndices.length) return null;

  return {
    rangeStart: rangeIndices[0]!,
    rangeEnd: rangeIndices[rangeIndices.length - 1]!,
    entryStart: entryIndices[0]!,
    entryEnd: entryIndices[entryIndices.length - 1]!
  };
}
