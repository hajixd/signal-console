import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { Side, StrategyRule } from "@/lib/types";
import { LONG, SHORT } from "./constants";
import { roundToTick } from "./helpers";

type NySweepModel = "logit" | "bayes" | "stump";

type NySweepOptions = {
  model: NySweepModel;
  threshold: number;
  rr: number;
  startMinutes: number;
  endMinutes: number;
  maxTests: number;
  minRiskUnits: number;
  maxRiskUnits: number;
  minWick: number;
};

type NySweepFeatures = {
  wick: number;
  reclaim: number;
  fresh: number;
  tests: number;
  testPenalty: number;
  body: number;
  trend: number;
  closeLocation: number;
  rsi: number;
  atrRisk: number;
};

type NySweepCandidate = {
  score: number;
  side: Side;
  swingIndex: number;
  tests: number;
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  tpUnits: number;
  slUnits: number;
};

const NY_SWEEP_START_MINUTES = 7 * 60;
const NY_SWEEP_END_MINUTES = 10 * 60;
const SWING_WIDTH = 4;
const SWING_LOOKBACK = 20;
const MAX_LEVEL_TESTS = 3;
const BUFFER_UNITS = 5;
const MAX_RISK_UNITS = 30;
const MIN_RISK_UNITS = 0;
const DEFAULT_THRESHOLD = 0.6;
const DEFAULT_RR = 2;

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function variantToken(variantId: string | undefined, key: string): string | undefined {
  if (!variantId) return undefined;
  for (const token of variantId.split("|")) {
    const [tokenKey, value] = token.split("=", 2);
    if (tokenKey === key && value) return value;
  }
  return undefined;
}

function variantNumber(variantId: string | undefined, key: string, fallback: number): number {
  const parsed = Number(variantToken(variantId, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nySweepOptions(rule: StrategyRule): NySweepOptions {
  const rawModel = variantToken(rule.variantId, "model");
  const model: NySweepModel = rawModel === "bayes" || rawModel === "stump" ? rawModel : "logit";
  return {
    model,
    threshold: variantNumber(rule.variantId, "min", DEFAULT_THRESHOLD),
    rr: variantNumber(rule.variantId, "rr", DEFAULT_RR),
    startMinutes: variantNumber(rule.variantId, "start", NY_SWEEP_START_MINUTES),
    endMinutes: variantNumber(rule.variantId, "end", NY_SWEEP_END_MINUTES),
    maxTests: variantNumber(rule.variantId, "max_tests", MAX_LEVEL_TESTS),
    minRiskUnits: variantNumber(rule.variantId, "risk_min", MIN_RISK_UNITS),
    maxRiskUnits: variantNumber(rule.variantId, "risk_max", MAX_RISK_UNITS),
    minWick: variantNumber(rule.variantId, "min_wick", 0)
  };
}

function sigmoid(value: number): number {
  const clipped = Math.max(-60, Math.min(60, value));
  return 1 / (1 + Math.exp(-clipped));
}

function isSwingHigh(bars: EnrichedBar[], index: number): boolean {
  if (index < SWING_WIDTH || index + SWING_WIDTH >= bars.length) return false;
  const level = bars[index]!.high;
  for (let cursor = index - SWING_WIDTH; cursor < index; cursor += 1) {
    if (level <= bars[cursor]!.high) return false;
  }
  for (let cursor = index + 1; cursor <= index + SWING_WIDTH; cursor += 1) {
    if (level < bars[cursor]!.high) return false;
  }
  return true;
}

function isSwingLow(bars: EnrichedBar[], index: number): boolean {
  if (index < SWING_WIDTH || index + SWING_WIDTH >= bars.length) return false;
  const level = bars[index]!.low;
  for (let cursor = index - SWING_WIDTH; cursor < index; cursor += 1) {
    if (level >= bars[cursor]!.low) return false;
  }
  for (let cursor = index + 1; cursor <= index + SWING_WIDTH; cursor += 1) {
    if (level > bars[cursor]!.low) return false;
  }
  return true;
}

function priorTestCount(bars: EnrichedBar[], side: Side, level: number, startIndex: number, endIndex: number, tickSize: number): number {
  let count = 0;
  for (let cursor = startIndex; cursor < endIndex; cursor += 1) {
    const bar = bars[cursor]!;
    if (side === SHORT && bar.high >= level - tickSize * 0.1) count += 1;
    if (side === LONG && bar.low <= level + tickSize * 0.1) count += 1;
  }
  return count;
}

function candidateFeatures(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number,
  side: Side,
  swingIndex: number,
  level: number,
  sweepExtreme: number,
  entryPrice: number,
  stopLossPrice: number
): NySweepFeatures {
  const signalBar = bars[signalIndex]!;
  const sideSign = side === LONG ? 1 : -1;
  const risk = Math.abs(entryPrice - stopLossPrice);
  const riskUnits = risk / rule.tickSize;
  const atr = finiteNumber(signalBar.atr14) && signalBar.atr14 > 0 ? signalBar.atr14 : risk;
  const tests = priorTestCount(bars, side, level, swingIndex + 1, signalIndex, rule.tickSize);
  const closeLocation = finiteNumber(signalBar.closeLocation) ? signalBar.closeLocation : 0.5;
  const rsi2 = finiteNumber(signalBar.rsi2) ? signalBar.rsi2 : 50;

  let trend = 0;
  if (finiteNumber(signalBar.ema50) && finiteNumber(signalBar.ema200)) {
    trend =
      (side === LONG && signalBar.ema50 > signalBar.ema200) || (side === SHORT && signalBar.ema50 < signalBar.ema200)
        ? 1
        : -0.5;
  }

  return {
    wick: Math.min(2, Math.abs(sweepExtreme - level) / rule.tickSize / Math.max(riskUnits, 1)),
    reclaim: Math.min(2, Math.abs(signalBar.close - level) / rule.tickSize / Math.max(riskUnits, 1)),
    fresh: Math.max(0, (SWING_LOOKBACK + 1 - (signalIndex - swingIndex)) / SWING_LOOKBACK),
    tests,
    testPenalty: Math.min(1, tests / MAX_LEVEL_TESTS),
    body: (sideSign * (signalBar.close - signalBar.open)) / atr,
    trend,
    closeLocation: side === LONG ? closeLocation : 1 - closeLocation,
    rsi: Math.max(-1, Math.min(1, side === LONG ? (50 - rsi2) / 50 : (rsi2 - 50) / 50)),
    atrRisk: atr > 0 ? risk / atr : 1
  };
}

function scoreNySweepCandidate(model: NySweepModel, features: NySweepFeatures): number {
  if (model === "logit") {
    return sigmoid(
      -0.95 +
        0.75 * features.wick +
        0.45 * features.reclaim +
        0.5 * features.body +
        0.3 * features.fresh -
        0.45 * features.testPenalty +
        0.2 * features.trend +
        0.2 * features.closeLocation +
        0.22 * features.rsi -
        0.12 * Math.max(0, features.atrRisk - 1)
    );
  }

  if (model === "bayes") {
    let logOdds = -0.55;
    logOdds += features.wick >= 0.25 ? 0.4 : -0.1;
    logOdds += features.body >= 0.05 ? 0.35 : -0.05;
    logOdds += features.fresh >= 0.45 ? 0.25 : -0.15;
    logOdds += features.tests <= 1 ? 0.2 : features.tests >= 3 ? -0.25 : 0;
    logOdds += features.closeLocation >= 0.55 ? 0.2 : -0.05;
    logOdds += features.rsi > 0 ? 0.15 : -0.05;
    logOdds += features.trend > 0 ? 0.12 : features.trend < 0 ? -0.08 : 0;
    return sigmoid(logOdds);
  }

  let score = 0.5;
  if (features.wick >= 0.35 && features.body >= 0.05 && features.tests <= 1) {
    score = 0.68;
  } else if (features.wick >= 0.2 && features.fresh >= 0.5 && features.tests <= 2) {
    score = 0.61;
  } else if (features.tests >= 3 || features.atrRisk > 1.8) {
    score = 0.43;
  }
  if (features.closeLocation >= 0.65) score += 0.04;
  if (features.rsi >= 0.25) score += 0.03;
  if (features.trend < 0) score -= 0.04;
  return Math.max(0.01, Math.min(0.99, score));
}

function buildCandidate(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number,
  side: Side,
  swingIndex: number,
  level: number,
  sweepExtreme: number,
  stopLossPrice: number,
  options: NySweepOptions
): NySweepCandidate | null {
  const signalBar = bars[signalIndex]!;
  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const risk = Math.abs(entryPrice - stopLossPrice);
  const riskUnits = risk / rule.tickSize;
  if (risk <= 0 || riskUnits < options.minRiskUnits || riskUnits > options.maxRiskUnits) return null;

  const tests = priorTestCount(bars, side, level, swingIndex + 1, signalIndex, rule.tickSize);
  if (tests > options.maxTests) return null;

  const features = candidateFeatures(rule, bars, signalIndex, side, swingIndex, level, sweepExtreme, entryPrice, stopLossPrice);
  if (features.wick < options.minWick) return null;
  const score = scoreNySweepCandidate(options.model, features);
  if (score < options.threshold) return null;

  const direction = side === LONG ? 1 : -1;
  const takeProfitPrice = roundToTick(entryPrice + direction * risk * options.rr, rule.tickSize);
  return {
    score,
    side,
    swingIndex,
    tests,
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
    tpUnits: Math.abs(takeProfitPrice - entryPrice) / rule.tickSize,
    slUnits: risk / rule.tickSize
  };
}

export function evaluateNySweepPlaybook(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number): StrategySignal | null {
  const signalBar = bars[signalIndex];
  if (!signalBar || signalIndex < 30 || rule.tickSize <= 0) return null;
  const options = nySweepOptions(rule);
  if (signalBar.nyWeekday > 4) return null;
  if (signalBar.nyMinutes < options.startMinutes || signalBar.nyMinutes > options.endMinutes) return null;

  const buffer = BUFFER_UNITS * rule.tickSize;
  let best: NySweepCandidate | null = null;

  for (let swingIndex = Math.max(SWING_WIDTH, signalIndex - SWING_LOOKBACK); swingIndex <= signalIndex - SWING_WIDTH; swingIndex += 1) {
    const swingBar = bars[swingIndex]!;

    if (isSwingHigh(bars, swingIndex) && signalBar.high > swingBar.high + rule.tickSize * 0.1 && signalBar.close < swingBar.high) {
      const stopLossPrice = roundToTick(signalBar.high + buffer, rule.tickSize);
      const candidate = buildCandidate(rule, bars, signalIndex, SHORT, swingIndex, swingBar.high, signalBar.high, stopLossPrice, options);
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }

    if (isSwingLow(bars, swingIndex) && signalBar.low < swingBar.low - rule.tickSize * 0.1 && signalBar.close > swingBar.low) {
      const stopLossPrice = roundToTick(signalBar.low - buffer, rule.tickSize);
      const candidate = buildCandidate(rule, bars, signalIndex, LONG, swingIndex, swingBar.low, signalBar.low, stopLossPrice, options);
      if (candidate && (!best || candidate.score > best.score)) best = candidate;
    }
  }

  if (!best) return null;

  return {
    side: best.side,
    entryPrice: best.entryPrice,
    takeProfitPrice: best.takeProfitPrice,
    stopLossPrice: best.stopLossPrice,
    tpUnits: best.tpUnits,
    slUnits: best.slUnits,
    signalTime: signalBar.time,
    entryType: "market",
    entryMode: "NY Sweep V4: 50% market on confirmation, 50% retrace limit at -0.5R",
    stopLossMode: "price",
    takeProfitMode: "risk_multiple",
    riskReward: options.rr,
    score: best.score,
    confidence: best.score,
    notes: `Lightweight ${options.model} score ${best.score.toFixed(2)}; swing age ${signalIndex - best.swingIndex} bars; prior tests ${best.tests}; TP is the +${options.rr}R partial trigger.`
  };
}
