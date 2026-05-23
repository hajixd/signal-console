import { dollarPerUnit, recommendedSizeMultiplier } from "@/lib/instruments";
import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import { priorDayRange, roundToTick } from "@/lib/strategy-runtime/helpers";
import { strategyRuntimeConfig } from "@/lib/strategy-runtime/runtime-config";
import type { BacktestPriceMode, BacktestSizeMode, Side, StrategyRule, TradeAlert } from "@/lib/types";

const PRICE_MODE_FIXED: BacktestPriceMode = "fixed";
const PRICE_MODE_CUSTOM: BacktestPriceMode = "custom";
const SIZE_MODE_AUTO: BacktestSizeMode = "auto";
const SIZE_MODE_CUSTOM: BacktestSizeMode = "custom";

function sideSign(side: Side): 1 | -1 {
  return side === "long" ? 1 : -1;
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function confidenceForSignal(signal: StrategySignal): number | undefined {
  if (finiteNumber(signal.confidence) && signal.confidence >= 0 && signal.confidence <= 1) return signal.confidence;
  if (finiteNumber(signal.score) && signal.score >= 0 && signal.score <= 1) return signal.score;
  return undefined;
}

function interpolateSizeMultiplier(rule: StrategyRule, confidence: number): number | null {
  const policy = rule.sizePolicy;
  if (!policy) return null;
  const minConfidence = policy.minConfidence ?? 0.5;
  const maxConfidence = policy.maxConfidence ?? 0.8;
  if (minConfidence < 0 || maxConfidence > 1 || minConfidence >= maxConfidence) return null;
  const clipped = Math.min(Math.max(confidence, minConfidence), maxConfidence);
  const pct = (clipped - minConfidence) / (maxConfidence - minConfidence);
  return Number((policy.minMultiplier + (policy.maxMultiplier - policy.minMultiplier) * pct).toFixed(2));
}

type ParsedCustomScaleRange = {
  riskCeiling: number;
  riskFloor: number;
  targetCeiling: number;
  targetFloor: number;
};

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function parseCustomScaleRange(rule: StrategyRule): ParsedCustomScaleRange | null {
  const range = rule.customScaleRange;
  if (!range) return null;
  const targetFloor = positiveNumber(range.targetFloor);
  const targetCeiling = positiveNumber(range.targetCeiling);
  const riskFloor = positiveNumber(range.riskFloor);
  const riskCeiling = positiveNumber(range.riskCeiling);

  if (!targetFloor || !targetCeiling || !riskFloor || !riskCeiling) return null;
  if (targetFloor > targetCeiling || riskFloor > riskCeiling) return null;
  return { riskCeiling, riskFloor, targetCeiling, targetFloor };
}

function customRangeSizeMultiplier(rule: StrategyRule, tpUnits: number, slUnits: number): number | null {
  const range = parseCustomScaleRange(rule);
  const dollarUnit = Math.abs(dollarPerUnit(rule.symbol));
  const targetAtOne = Math.abs(tpUnits * dollarUnit);
  const riskAtOne = Math.abs(slUnits * dollarUnit);
  if (!range || !(targetAtOne > 0) || !(riskAtOne > 0)) return null;

  const scale = Math.min(range.targetCeiling / targetAtOne, range.riskCeiling / riskAtOne);
  return Number.isFinite(scale) && scale > 0 ? Number(scale.toFixed(4)) : null;
}

function priorDayExtremes(bars: EnrichedBar[], signalIndex: number): { high: number; low: number } | null {
  return priorDayRange(bars, signalIndex);
}

function stopLossFromPolicy(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number, side: Side): number | null {
  const policy = rule.stopLossPolicy;
  if (!policy) return null;
  const signalBar = bars[signalIndex];
  if (!signalBar) return null;
  const buffer = (policy.bufferUnits ?? 0) * rule.tickSize;
  if (policy.mode === "signal_extreme") {
    const reference = side === "long" ? signalBar.low : signalBar.high;
    return roundToTick(side === "long" ? reference - buffer : reference + buffer, rule.tickSize);
  }
  const priorDay = priorDayExtremes(bars, signalIndex);
  if (!priorDay) return null;
  const reference = side === "long" ? priorDay.low : priorDay.high;
  return roundToTick(side === "long" ? reference - buffer : reference + buffer, rule.tickSize);
}

function takeProfitFromPolicy(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number,
  side: Side,
  entryPrice: number,
  stopLossPrice: number
): number | null {
  const policy = rule.takeProfitPolicy;
  if (!policy) return null;
  if (policy.mode === "risk_multiple") {
    if (!finiteNumber(policy.rewardMultiple) || policy.rewardMultiple <= 0) return null;
    const direction = sideSign(side);
    return roundToTick(entryPrice + direction * Math.abs(entryPrice - stopLossPrice) * policy.rewardMultiple, rule.tickSize);
  }
  const signalBar = bars[signalIndex];
  if (!signalBar) return null;
  const buffer = (policy.bufferUnits ?? 0) * rule.tickSize;
  if (policy.mode === "signal_extreme") {
    const reference = side === "long" ? signalBar.high : signalBar.low;
    return roundToTick(side === "long" ? reference + buffer : reference - buffer, rule.tickSize);
  }
  const priorDay = priorDayExtremes(bars, signalIndex);
  if (!priorDay) return null;
  const reference = side === "long" ? priorDay.high : priorDay.low;
  return roundToTick(side === "long" ? reference + buffer : reference - buffer, rule.tickSize);
}

function tradeLevelsValid(side: Side, entryPrice: number, stopLossPrice: number, takeProfitPrice: number, tickSize: number): boolean {
  const tolerance = Math.max(Math.abs(tickSize), 1e-12) * 0.5;
  if (side === "long") return stopLossPrice < entryPrice - tolerance && takeProfitPrice > entryPrice + tolerance;
  return stopLossPrice > entryPrice + tolerance && takeProfitPrice < entryPrice - tolerance;
}

export function planTradeAlert(
  rule: StrategyRule,
  signal: StrategySignal,
  bars: EnrichedBar[],
  signalIndex: number,
  fallbackEntryMode: string
): TradeAlert | null {
  const direction = sideSign(signal.side);
  const entryPrice = roundToTick(signal.entryPrice, rule.tickSize);

  let stopLossPrice = roundToTick(signal.stopLossPrice, rule.tickSize);
  let slUnits = finiteNumber(signal.slUnits) && signal.slUnits > 0 ? Math.abs(signal.slUnits) : Math.abs(entryPrice - stopLossPrice) / rule.tickSize;
  let slMode: BacktestPriceMode =
    rule.stopLossPolicy || rule.dynamicStopLossPolicy || signal.stopLossMode === "price" ? PRICE_MODE_CUSTOM : PRICE_MODE_FIXED;

  const policyStopLoss = stopLossFromPolicy(rule, bars, signalIndex, signal.side);
  if (finiteNumber(policyStopLoss)) {
    stopLossPrice = policyStopLoss;
    slUnits = Math.abs(entryPrice - stopLossPrice) / rule.tickSize;
    slMode = PRICE_MODE_CUSTOM;
  } else if (signal.stopLossMode === "units" && slUnits > 0) {
    stopLossPrice = roundToTick(entryPrice - direction * slUnits * rule.tickSize, rule.tickSize);
  } else {
    slUnits = Math.abs(entryPrice - stopLossPrice) / rule.tickSize;
  }

  let takeProfitPrice = roundToTick(signal.takeProfitPrice, rule.tickSize);
  let tpUnits = finiteNumber(signal.tpUnits) && signal.tpUnits > 0 ? Math.abs(signal.tpUnits) : Math.abs(takeProfitPrice - entryPrice) / rule.tickSize;
  let tpMode: BacktestPriceMode =
    rule.takeProfitPolicy || rule.dynamicTakeProfitPolicy || signal.takeProfitMode === "price" || signal.takeProfitMode === "risk_multiple"
      ? PRICE_MODE_CUSTOM
      : PRICE_MODE_FIXED;

  const policyTakeProfit = takeProfitFromPolicy(rule, bars, signalIndex, signal.side, entryPrice, stopLossPrice);
  if (finiteNumber(policyTakeProfit)) {
    takeProfitPrice = policyTakeProfit;
    tpUnits = Math.abs(takeProfitPrice - entryPrice) / rule.tickSize;
    tpMode = PRICE_MODE_CUSTOM;
  } else if (signal.takeProfitMode === "risk_multiple" && finiteNumber(signal.riskReward) && signal.riskReward > 0) {
    takeProfitPrice = roundToTick(entryPrice + direction * Math.abs(entryPrice - stopLossPrice) * signal.riskReward, rule.tickSize);
    tpUnits = Math.abs(takeProfitPrice - entryPrice) / rule.tickSize;
    tpMode = PRICE_MODE_CUSTOM;
  } else if (signal.takeProfitMode === "units" && tpUnits > 0) {
    takeProfitPrice = roundToTick(entryPrice + direction * tpUnits * rule.tickSize, rule.tickSize);
  } else {
    tpUnits = Math.abs(takeProfitPrice - entryPrice) / rule.tickSize;
  }

  if (!finiteNumber(stopLossPrice) || !finiteNumber(takeProfitPrice) || !finiteNumber(slUnits) || !finiteNumber(tpUnits)) {
    return null;
  }
  if (slUnits <= 0 || tpUnits <= 0 || !tradeLevelsValid(signal.side, entryPrice, stopLossPrice, takeProfitPrice, rule.tickSize)) {
    return null;
  }

  let sizeMultiplier = signal.sizeMultiplier;
  let sizeMode: BacktestSizeMode =
    rule.sizePolicy || finiteNumber(rule.sizeMultiplier) || finiteNumber(signal.sizeMultiplier) ? SIZE_MODE_CUSTOM : SIZE_MODE_AUTO;
  if (rule.sizePolicy) {
    const confidence = confidenceForSignal(signal);
    if (!finiteNumber(confidence)) return null;
    const interpolated = interpolateSizeMultiplier(rule, confidence);
    if (!finiteNumber(interpolated) || interpolated <= 0) return null;
    sizeMultiplier = interpolated;
    sizeMode = SIZE_MODE_CUSTOM;
  } else if (!finiteNumber(sizeMultiplier) || sizeMultiplier <= 0) {
    sizeMultiplier =
      finiteNumber(rule.sizeMultiplier) && rule.sizeMultiplier > 0
        ? rule.sizeMultiplier
        : recommendedSizeMultiplier({
            symbol: rule.symbol,
            tpUnits,
            slUnits
          });
    sizeMode = finiteNumber(rule.sizeMultiplier) && rule.sizeMultiplier > 0 ? SIZE_MODE_CUSTOM : SIZE_MODE_AUTO;
  }

  const customSizeMultiplier = customRangeSizeMultiplier(rule, tpUnits, slUnits);
  if (finiteNumber(customSizeMultiplier) && customSizeMultiplier > 0) {
    sizeMultiplier = customSizeMultiplier;
    sizeMode = SIZE_MODE_CUSTOM;
  }

  return {
    id: `${rule.key}:${signal.side}:${signal.signalTime}`,
    createdAt: new Date().toISOString(),
    signalTime: signal.signalTime,
    strategyKey: rule.key,
    logicalStrategyKey: rule.logicalKey,
    datasetId: rule.datasetId,
    strategyId: rule.strategyId,
    assetKey: rule.assetKey,
    entryMode: signal.entryMode ?? fallbackEntryMode,
    entryType: signal.entryType ?? "market",
    market: rule.market,
    symbol: rule.symbol,
    strategy: rule.label,
    side: signal.side,
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
    tpUnits,
    slUnits,
    tpMode,
    slMode,
    sizeMode,
    unitLabel: rule.unitLabel,
    sizeScale: finiteNumber(rule.sizeScale) && rule.sizeScale > 0 ? rule.sizeScale : undefined,
    sizeMultiplier: sizeMultiplier ?? 1,
    estimatedWinRatePct: rule.estimatedWinRatePct,
    liveProfitFactor: rule.liveProfitFactor,
    maxBars: Math.max(1, Math.round(strategyRuntimeConfig(rule.variantId).maxBars)),
    status: "alerted",
    telegramStatus: "skipped",
    notes: signal.notes
  };
}
