import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { StrategyRule } from "@/lib/types";
import { LONG, SHORT } from "./constants";
import { allowedByTrend, roundToTick, sessionMinutes } from "./helpers";
import { strategyRuntimeConfig, type StrategyTrend } from "./runtime-config";

type RoundNumberConfig = {
  model: "none" | "stump" | "bayes" | "logit";
  threshold: number;
  step: number;
  touchPoints: number;
  sweepPoints: number;
  reclaimPoints: number;
  priorCloseMaxPoints: number;
  minWickPct: number;
  minRangeAtr: number;
  maxRangeAtr: number;
  minRiskPoints: number;
  maxRiskPoints: number;
  stopBufferPoints: number;
  riskReward: number;
  trend: StrategyTrend;
};

function variantValue(variantId: string | undefined, key: string): string | undefined {
  if (!variantId) return undefined;
  for (const token of variantId.split("|")) {
    const [tokenKey, rawValue] = token.split("=", 2);
    if (tokenKey === key && rawValue) return rawValue;
  }
  return undefined;
}

function variantNumber(variantId: string | undefined, key: string, fallback: number): number {
  const parsed = Number(variantValue(variantId, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function configFromRule(rule: StrategyRule): RoundNumberConfig {
  const runtime = strategyRuntimeConfig(rule.variantId);
  const rawModel = variantValue(rule.variantId, "model");
  const touchPoints = Math.max(rule.tickSize, variantNumber(rule.variantId, "touch", 12));
  return {
    model: rawModel === "stump" || rawModel === "bayes" || rawModel === "logit" ? rawModel : "none",
    threshold: Math.max(0, Math.min(1, variantNumber(rule.variantId, "min", 0))),
    step: Math.max(10, variantNumber(rule.variantId, "step", 100)),
    touchPoints,
    sweepPoints: Math.max(touchPoints, variantNumber(rule.variantId, "sweep", touchPoints * 2)),
    reclaimPoints: Math.max(rule.tickSize, variantNumber(rule.variantId, "reclaim", 3)),
    priorCloseMaxPoints: Math.max(rule.tickSize, variantNumber(rule.variantId, "prev_max", Number.POSITIVE_INFINITY)),
    minWickPct: Math.max(0.05, Math.min(0.9, variantNumber(rule.variantId, "wick", 0.36))),
    minRangeAtr: Math.max(0, variantNumber(rule.variantId, "atr_min", 0.25)),
    maxRangeAtr: Math.max(0.5, variantNumber(rule.variantId, "atr_max", 2.75)),
    minRiskPoints: Math.max(rule.tickSize, variantNumber(rule.variantId, "risk_min", 10)),
    maxRiskPoints: Math.max(rule.tickSize, variantNumber(rule.variantId, "risk_max", 80)),
    stopBufferPoints: Math.max(rule.tickSize, variantNumber(rule.variantId, "stop", 4)),
    riskReward: Math.max(0.2, runtime.rr),
    trend: runtime.trend
  };
}

function sigmoid(value: number): number {
  const clipped = Math.max(-60, Math.min(60, value));
  return 1 / (1 + Math.exp(-clipped));
}

function roundNumberModelScore(
  config: RoundNumberConfig,
  signalBar: EnrichedBar,
  previousBar: EnrichedBar,
  side: "long" | "short",
  level: number,
  barRange: number,
  wickPct: number
): number {
  if (config.model === "none") return 1;

  const sideSign = side === LONG ? 1 : -1;
  const priorCloseDistance = side === LONG ? previousBar.close - level : level - previousBar.close;
  const closeDistance = side === LONG ? signalBar.close - level : level - signalBar.close;
  const highLowDistance = side === LONG ? level - signalBar.low : signalBar.high - level;
  const atr = finiteNumber(signalBar.atr14) && signalBar.atr14 > 0 ? signalBar.atr14 : barRange;
  const trend =
    finiteNumber(signalBar.ema30) && finiteNumber(signalBar.ema200) && atr > 0
      ? sideSign * (signalBar.ema30 - signalBar.ema200) / atr
      : 0;
  const rsi2 = finiteNumber(signalBar.rsi2) ? signalBar.rsi2 : 50;
  const directionalRsi = side === LONG ? (50 - rsi2) / 50 : (rsi2 - 50) / 50;

  if (config.model === "stump") {
    if (priorCloseDistance <= config.priorCloseMaxPoints && closeDistance >= config.reclaimPoints) return 0.74;
    return 0.42;
  }

  if (config.model === "bayes") {
    let logOdds = -0.7;
    logOdds += priorCloseDistance <= config.priorCloseMaxPoints ? 1.1 : -0.55;
    logOdds += wickPct >= config.minWickPct + 0.2 ? 0.25 : -0.05;
    logOdds += highLowDistance >= config.touchPoints ? 0.2 : -0.05;
    logOdds += closeDistance >= config.reclaimPoints * 2 ? 0.15 : 0;
    logOdds += directionalRsi > 0 ? 0.12 : -0.06;
    logOdds += trend < -0.5 ? 0.12 : trend > 1.5 ? -0.12 : 0;
    return sigmoid(logOdds);
  }

  return sigmoid(
    -1.15 -
      0.055 * priorCloseDistance +
      0.018 * closeDistance +
      1.2 * wickPct +
      0.012 * highLowDistance +
      0.15 * directionalRsi -
      0.04 * Math.max(0, trend)
  );
}

function levelsNearBar(low: number, high: number, step: number, reach: number): number[] {
  const first = Math.floor((low - reach) / step) * step;
  const last = Math.ceil((high + reach) / step) * step;
  const levels: number[] = [];
  for (let level = first; level <= last; level += step) {
    levels.push(level);
  }
  return levels;
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildRoundNumberSignal(
  rule: StrategyRule,
  signalBar: EnrichedBar,
  previousBar: EnrichedBar,
  side: "long" | "short",
  level: number,
  config: RoundNumberConfig,
  barRange: number,
  wickPct: number
): StrategySignal | null {
  const modelScore = roundNumberModelScore(config, signalBar, previousBar, side, level, barRange, wickPct);
  if (modelScore < config.threshold) return null;

  const direction = side === LONG ? 1 : -1;
  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const stopReference = side === LONG ? Math.min(signalBar.low, level) : Math.max(signalBar.high, level);
  const stopLossPrice = roundToTick(stopReference - direction * config.stopBufferPoints, rule.tickSize);
  const riskPoints = Math.abs(entryPrice - stopLossPrice);
  if (riskPoints < config.minRiskPoints || riskPoints > config.maxRiskPoints) return null;

  const takeProfitPrice = roundToTick(entryPrice + direction * riskPoints * config.riskReward, rule.tickSize);
  return {
    side,
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
    tpUnits: Math.abs(takeProfitPrice - entryPrice) / rule.tickSize,
    slUnits: riskPoints / rule.tickSize,
    signalTime: signalBar.time,
    entryType: "market",
    entryMode: "Round-number 100 handle rejection; market order enters on the next 15m open",
    stopLossMode: "price",
    takeProfitMode: "risk_multiple",
    riskReward: config.riskReward,
    score: modelScore,
    confidence: modelScore,
    notes: `Round-number ${side === LONG ? "support" : "resistance"} rejection at ${level.toFixed(0)}; ${config.model} score ${modelScore.toFixed(2)}.`
  };
}

export function evaluateRoundNumberRejection(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number
): StrategySignal | null {
  const signalBar = bars[signalIndex];
  const previousBar = bars[signalIndex - 1];
  if (!signalBar || !previousBar || !finiteNumber(signalBar.atr14) || rule.tickSize <= 0) return null;

  const runtime = strategyRuntimeConfig(rule.variantId);
  const session = sessionMinutes(runtime);
  if (signalBar.nyMinutes < session.start || signalBar.nyMinutes > session.end) return null;

  const config = configFromRule(rule);
  const barRange = signalBar.high - signalBar.low;
  if (!Number.isFinite(barRange) || barRange <= 0) return null;

  const rangeAtr = barRange / signalBar.atr14;
  if (rangeAtr < config.minRangeAtr || rangeAtr > config.maxRangeAtr) return null;

  const lowerWick = Math.min(signalBar.open, signalBar.close) - signalBar.low;
  const upperWick = signalBar.high - Math.max(signalBar.open, signalBar.close);
  const closeLocation = signalBar.closeLocation;
  if (!finiteNumber(closeLocation)) return null;

  for (const level of levelsNearBar(signalBar.low, signalBar.high, config.step, config.sweepPoints)) {
    const sweptSupport = signalBar.low <= level + config.touchPoints && signalBar.low >= level - config.sweepPoints;
    const reclaimedSupport = signalBar.close >= level + config.reclaimPoints && previousBar.close >= level + config.reclaimPoints;
    const supportWick = lowerWick / barRange >= config.minWickPct && closeLocation >= 0.58;
    if (sweptSupport && reclaimedSupport && supportWick && allowedByTrend(signalBar, LONG, config.trend)) {
      const signal = buildRoundNumberSignal(rule, signalBar, previousBar, LONG, level, config, barRange, lowerWick / barRange);
      if (signal) return signal;
    }

    const sweptResistance = signalBar.high >= level - config.touchPoints && signalBar.high <= level + config.sweepPoints;
    const rejectedResistance = signalBar.close <= level - config.reclaimPoints && previousBar.close <= level - config.reclaimPoints;
    const resistanceWick = upperWick / barRange >= config.minWickPct && closeLocation <= 0.42;
    if (sweptResistance && rejectedResistance && resistanceWick && allowedByTrend(signalBar, SHORT, config.trend)) {
      const signal = buildRoundNumberSignal(rule, signalBar, previousBar, SHORT, level, config, barRange, upperWick / barRange);
      if (signal) return signal;
    }
  }

  return null;
}
