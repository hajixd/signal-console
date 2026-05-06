import type { EnrichedBar } from "@/lib/indicators";
import type { Side, StrategyRule } from "@/lib/types";
import type { StrategySignal } from "@/lib/strategy-definition";
import { LONG, SHORT } from "./constants";
import { allowedByTrend, roundToTick } from "./helpers";

type PercentileRangeConfig = {
  rangeBars: number;
  studyBars: number;
  horizonBars: number;
  buckets: number;
  minSamples: number;
  edgeTicks: number;
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

function variantTrend(variantId: string | undefined): PercentileRangeConfig["trend"] {
  const value = variantValue(variantId, "trend");
  if (value === "all" || value === "both" || value === "ema" || value === "long_only" || value === "short_only") {
    return value;
  }
  return "ema";
}

function configFromRule(rule: StrategyRule): PercentileRangeConfig {
  return {
    rangeBars: Math.max(5, Math.round(variantNumber(rule.variantId, "range", 96))),
    studyBars: Math.max(50, Math.round(variantNumber(rule.variantId, "study", 480))),
    horizonBars: Math.max(1, Math.round(variantNumber(rule.variantId, "horizon", 6))),
    buckets: Math.max(5, Math.round(variantNumber(rule.variantId, "buckets", 20))),
    minSamples: Math.max(3, Math.round(variantNumber(rule.variantId, "min_samples", 12))),
    edgeTicks: Math.max(0, variantNumber(rule.variantId, "edge_ticks", 8)),
    trend: variantTrend(rule.variantId)
  };
}

function rollingRangePosition(bars: EnrichedBar[], index: number, rangeBars: number): number | null {
  const start = Math.max(0, index - rangeBars + 1);
  if (index - start + 1 < rangeBars) return null;

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

function bucketForPosition(position: number, buckets: number): number {
  return Math.min(buckets - 1, Math.max(0, Math.floor(position * buckets)));
}

function bucketTendency(
  bars: EnrichedBar[],
  index: number,
  targetBucket: number,
  config: PercentileRangeConfig,
  tickSize: number
): { averageTicks: number; samples: number } {
  const firstSample = Math.max(config.rangeBars - 1, index - config.horizonBars - config.studyBars + 1);
  const lastSample = index - config.horizonBars;
  let totalTicks = 0;
  let samples = 0;

  for (let sampleIndex = firstSample; sampleIndex <= lastSample; sampleIndex += 1) {
    const samplePosition = rollingRangePosition(bars, sampleIndex, config.rangeBars);
    if (samplePosition === null) continue;
    if (bucketForPosition(samplePosition, config.buckets) !== targetBucket) continue;

    totalTicks += (bars[sampleIndex + config.horizonBars]!.close - bars[sampleIndex]!.close) / tickSize;
    samples += 1;
  }

  return {
    averageTicks: samples > 0 ? totalTicks / samples : 0,
    samples
  };
}

export function evaluatePercentileRangeStudy(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number
): StrategySignal | null {
  const signalBar = bars[signalIndex];
  if (!signalBar || rule.tickSize <= 0) return null;

  const config = configFromRule(rule);
  if (signalIndex < config.rangeBars + config.horizonBars + config.minSamples) return null;

  const position = rollingRangePosition(bars, signalIndex, config.rangeBars);
  if (position === null) return null;

  const bucket = bucketForPosition(position, config.buckets);
  const tendency = bucketTendency(bars, signalIndex, bucket, config, rule.tickSize);
  if (tendency.samples < config.minSamples || Math.abs(tendency.averageTicks) < config.edgeTicks) return null;

  const side: Side = tendency.averageTicks > 0 ? LONG : SHORT;
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
    score: Math.abs(tendency.averageTicks),
    confidence: Math.min(0.99, Math.abs(tendency.averageTicks) / Math.max(config.edgeTicks, 1)),
    notes: `rangePct=${position.toFixed(3)} bucket=${bucket + 1}/${config.buckets} avgForwardTicks=${tendency.averageTicks.toFixed(2)} samples=${tendency.samples}`
  };
}
