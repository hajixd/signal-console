import type { EnrichedBar } from "@/lib/indicators";
import type { Side, StrategyRule } from "@/lib/types";
import type { StrategySignal } from "@/lib/strategy-definition";
import { LONG, SHORT } from "./constants";
import { allowedByTrend, roundToTick } from "./helpers";

type DecileEdgeConfig = {
  rangeBars: number;
  buckets: number;
  longDeciles: Set<number>;
  shortDeciles: Set<number>;
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

function variantNumber(variantId: string | undefined, key: string, fallback: number): number {
  const rawValue = variantValue(variantId, key);
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function variantDeciles(variantId: string | undefined, key: string, fallback: number[]): Set<number> {
  const rawValue = variantValue(variantId, key);
  const values = rawValue
    ? rawValue
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 10)
    : fallback;
  return new Set(values);
}

function variantTrend(variantId: string | undefined): DecileEdgeConfig["trend"] {
  const value = variantValue(variantId, "trend");
  if (value === "all" || value === "both" || value === "ema" || value === "long_only" || value === "short_only") {
    return value;
  }
  return "ema";
}

function configFromRule(rule: StrategyRule): DecileEdgeConfig {
  return {
    rangeBars: Math.max(5, Math.round(variantNumber(rule.variantId, "range", 96))),
    buckets: Math.max(5, Math.round(variantNumber(rule.variantId, "buckets", 10))),
    longDeciles: variantDeciles(rule.variantId, "long", [10]),
    shortDeciles: variantDeciles(rule.variantId, "short", [1]),
    trend: variantTrend(rule.variantId)
  };
}

function rangePosition(bars: EnrichedBar[], index: number, rangeBars: number): number | null {
  const start = index - rangeBars + 1;
  if (start < 0) return null;

  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  for (let cursor = start; cursor <= index; cursor += 1) {
    high = Math.max(high, bars[cursor]!.high);
    low = Math.min(low, bars[cursor]!.low);
  }

  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) return null;
  return Math.min(1, Math.max(0, (bars[index]!.close - low) / range));
}

function decileForPosition(position: number, buckets: number): number {
  return Math.min(buckets, Math.max(1, Math.floor(position * buckets) + 1));
}

function decileAt(bars: EnrichedBar[], index: number, config: DecileEdgeConfig): number | null {
  const position = rangePosition(bars, index, config.rangeBars);
  return position === null ? null : decileForPosition(position, config.buckets);
}

export function evaluateDecileForwardEdge(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number
): StrategySignal | null {
  const signalBar = bars[signalIndex];
  if (!signalBar || rule.tickSize <= 0) return null;

  const config = configFromRule(rule);
  const decile = decileAt(bars, signalIndex, config);
  const priorDecile = signalIndex > 0 ? decileAt(bars, signalIndex - 1, config) : null;
  if (decile === null || decile === priorDecile) return null;

  let side: Side | null = null;
  if (config.longDeciles.has(decile)) {
    side = LONG;
  } else if (config.shortDeciles.has(decile)) {
    side = SHORT;
  }
  if (!side || !allowedByTrend(signalBar, side, config.trend)) return null;

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
    score: decile,
    notes: `decile=${decile}/${config.buckets} rangeBars=${config.rangeBars}`
  };
}
