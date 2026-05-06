import type { EnrichedBar } from "@/lib/indicators";
import type { Side, StrategyRule } from "@/lib/types";
import type { StrategySignal } from "@/lib/strategy-definition";
import { LONG, SHORT } from "./constants";
import { allowedByTrend, roundToTick } from "./helpers";

type MovingAverageKind = "EMA" | "SMA";
type TouchSide = "support_long" | "resistance_short";

type MovingAverageConfig = {
  kind: MovingAverageKind;
  length: number;
  side: TouchSide;
  fresh: boolean;
  trend: "all" | "both" | "ema" | "long_only" | "short_only";
};

function variantValue(variantId: string | undefined, key: string): string | undefined {
  if (!variantId) return undefined;
  for (const token of variantId.split("|")) {
    const [tokenKey, rawValue] = token.split("=");
    if (tokenKey === key && rawValue) return rawValue;
  }
  return undefined;
}

function variantTrend(variantId: string | undefined): MovingAverageConfig["trend"] {
  const value = variantValue(variantId, "trend");
  if (value === "all" || value === "both" || value === "ema" || value === "long_only" || value === "short_only") {
    return value;
  }
  return "all";
}

function configFromRule(rule: StrategyRule): MovingAverageConfig {
  const ma = variantValue(rule.variantId, "ma") ?? "SMA20";
  const match = ma.match(/^(EMA|SMA)(\d+)$/i);
  const side = variantValue(rule.variantId, "side");
  return {
    kind: match?.[1]?.toUpperCase() === "EMA" ? "EMA" : "SMA",
    length: Math.max(2, Number(match?.[2] ?? 20)),
    side: side === "resistance_short" ? "resistance_short" : "support_long",
    fresh: variantValue(rule.variantId, "fresh") !== "0",
    trend: variantTrend(rule.variantId)
  };
}

function smaAt(bars: EnrichedBar[], index: number, length: number): number | null {
  if (index + 1 < length) return null;
  let total = 0;
  for (let cursor = index - length + 1; cursor <= index; cursor += 1) {
    total += bars[cursor]!.close;
  }
  return total / length;
}

function emaAt(bars: EnrichedBar[], index: number, length: number): number | null {
  if (length === 9) return bars[index]?.ema9 ?? null;
  if (length === 21) return bars[index]?.ema21 ?? null;
  if (length === 34) return bars[index]?.ema34 ?? null;
  if (length === 50) return bars[index]?.ema50 ?? null;
  if (length === 200) return bars[index]?.ema200 ?? null;
  if (index < 0) return null;

  const alpha = 2 / (length + 1);
  let current = bars[0]!.close;
  for (let cursor = 1; cursor <= index; cursor += 1) {
    current = alpha * bars[cursor]!.close + (1 - alpha) * current;
  }
  return current;
}

function movingAverageAt(bars: EnrichedBar[], index: number, config: MovingAverageConfig): number | null {
  if (index < 0) return null;
  return config.kind === "EMA" ? emaAt(bars, index, config.length) : smaAt(bars, index, config.length);
}

function touched(bar: EnrichedBar, average: number, side: TouchSide): boolean {
  if (side === "support_long") {
    return bar.low <= average && bar.close >= average;
  }
  return bar.high >= average && bar.close <= average;
}

export function evaluateMovingAverageTouch(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number
): StrategySignal | null {
  const signalBar = bars[signalIndex];
  const priorBar = bars[signalIndex - 1];
  if (!signalBar || !priorBar || rule.tickSize <= 0) return null;

  const config = configFromRule(rule);
  const average = movingAverageAt(bars, signalIndex, config);
  const priorAverage = movingAverageAt(bars, signalIndex - 1, config);
  if (average === null || priorAverage === null) return null;

  if (config.side === "support_long") {
    if (priorBar.close <= priorAverage || !touched(signalBar, average, config.side)) return null;
  } else if (priorBar.close >= priorAverage || !touched(signalBar, average, config.side)) {
    return null;
  }

  if (config.fresh && touched(priorBar, priorAverage, config.side)) return null;

  const side: Side = config.side === "support_long" ? LONG : SHORT;
  if (!allowedByTrend(signalBar, side, config.trend)) return null;

  const direction = side === LONG ? 1 : -1;
  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const tpUnits = rule.tpUnits;
  const slUnits = rule.slUnits;

  return {
    side,
    entryPrice,
    takeProfitPrice: roundToTick(entryPrice + direction * tpUnits * rule.tickSize, rule.tickSize),
    stopLossPrice: roundToTick(entryPrice - direction * slUnits * rule.tickSize, rule.tickSize),
    tpUnits,
    slUnits,
    signalTime: signalBar.time,
    notes: `${config.kind}${config.length} ${config.side} touch`
  };
}
