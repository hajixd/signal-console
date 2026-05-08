import type { EnrichedBar } from "@/lib/indicators";
import type { Side, StrategyRule } from "@/lib/types";
import type { StrategySignal } from "@/lib/strategy-definition";
import { LONG, SHORT } from "./constants";
import { roundToTick } from "./helpers";

function noRecentSignal(signals: boolean[], index: number, lookback: number): boolean {
  const start = Math.max(0, index - lookback);
  for (let cursor = start; cursor < index; cursor += 1) {
    if (signals[cursor]) return false;
  }
  return true;
}

function priceMoveSignals(bars: EnrichedBar[], multiplier: number): { up: boolean[]; down: boolean[] } {
  const up = bars.map(() => false);
  const down = bars.map(() => false);
  for (let index = 5; index < bars.length; index += 1) {
    const atr = bars[index]!.atr100;
    if (!atr) continue;
    up[index] = bars[index]!.close > bars[index - 5]!.close + atr * multiplier;
    down[index] = bars[index]!.close < bars[index - 5]!.close - atr * multiplier;
  }
  return { up, down };
}

function passesEchoFilters(bar: EnrichedBar, side: Side, rule: StrategyRule): boolean {
  if (rule.absCloseEma200AtrMax !== undefined) {
    if (bar.closeEma200Atr === null || Math.abs(bar.closeEma200Atr) > rule.absCloseEma200AtrMax) return false;
  }
  if (rule.phase === "mean_reversion") {
    const sideSign = side === LONG ? 1 : -1;
    if (bar.rsi14Centered === null) return false;
    const tradeRsi = sideSign * bar.rsi14Centered;
    if (rule.tradeRsiMin !== undefined && tradeRsi < rule.tradeRsiMin) return false;
    if (rule.tradeRsiMax !== undefined && tradeRsi > rule.tradeRsiMax) return false;
  }
  return true;
}

function finiteNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sideSign(side: Side): number {
  return side === LONG ? 1 : -1;
}

function sigmoid(value: number): number {
  const clipped = Math.max(-30, Math.min(30, value));
  return 1 / (1 + Math.exp(-clipped));
}

function echoFeatureVector(bars: EnrichedBar[], index: number, side: Side): number[] | null {
  const bar = bars[index];
  const prior = bars[index - 5];
  if (!bar || !prior) return null;
  const direction = sideSign(side);
  const atr100 = finiteNumber(bar.atr100, 0);
  const atr14 = finiteNumber(bar.atr14, atr100);
  if (atr100 <= 0 || atr14 <= 0) return null;
  const ema30 = finiteNumber(bar.ema30, bar.close);
  const ema200 = finiteNumber(bar.ema200, bar.close);
  const closeLocation = finiteNumber(bar.closeLocation, 0.5);
  const directionalCloseLocation = side === LONG ? closeLocation * 2 - 1 : (1 - closeLocation) * 2 - 1;
  const sessionVwap = finiteNumber(bar.sessionVwap, bar.close);

  return [
    (direction * (ema30 - ema200)) / atr100,
    direction * finiteNumber(bar.closeEma200Atr, 0),
    (direction * (bar.close - prior.close)) / atr100,
    direction * finiteNumber(bar.ret3Atr, 0),
    direction * finiteNumber(bar.bodyAtr, 0),
    direction * finiteNumber(bar.rsi14Centered, 0),
    direction * ((finiteNumber(bar.rsi2, 50) - 50) / 50),
    direction * finiteNumber(bar.bbZ20, 0),
    directionalCloseLocation,
    (direction * (bar.close - sessionVwap)) / atr14,
    (bar.nyMinutes - 720) / 720,
    bar.nyWeekday / 4
  ];
}

function echoModelScore(rule: StrategyRule, bars: EnrichedBar[], index: number, side: Side): number | null {
  const model = rule.echoModel;
  if (!model) return null;
  const features = echoFeatureVector(bars, index, side);
  if (!features) return null;
  if (
    model.featureMeans.length !== features.length ||
    model.featureScales.length !== features.length ||
    model.hiddenWeights.length !== model.hiddenBias.length ||
    model.outputWeights.length !== model.hiddenWeights.length
  ) {
    return null;
  }

  let output = model.outputBias;
  for (let row = 0; row < model.hiddenWeights.length; row += 1) {
    const weights = model.hiddenWeights[row];
    if (!weights || weights.length !== features.length) return null;
    let hidden = model.hiddenBias[row] ?? 0;
    for (let column = 0; column < features.length; column += 1) {
      const scale = model.featureScales[column] || 1;
      hidden += ((features[column]! - model.featureMeans[column]!) / scale) * weights[column]!;
    }
    output += Math.tanh(hidden) * model.outputWeights[row]!;
  }
  return sigmoid(output);
}

export function evaluateEchoStylePhase(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number): StrategySignal | null {
  const signalBar = bars[signalIndex];
  if (!signalBar || signalBar.ema30 === null || signalBar.ema200 === null) return null;

  const multiplier = rule.signalAtrMult ?? 2;
  const recentLookback = rule.recentSignalLookback ?? 10;
  const { up, down } = priceMoveSignals(bars, multiplier);

  let side: Side | null = null;
  if (rule.phase === "mean_reversion") {
    const longTrend = signalBar.ema30 < signalBar.ema200;
    const shortTrend = signalBar.ema30 > signalBar.ema200;
    if (longTrend && up[signalIndex] && noRecentSignal(up, signalIndex, recentLookback) && passesEchoFilters(signalBar, LONG, rule)) {
      side = LONG;
    } else if (
      shortTrend &&
      down[signalIndex] &&
      noRecentSignal(down, signalIndex, recentLookback) &&
      passesEchoFilters(signalBar, SHORT, rule)
    ) {
      side = SHORT;
    }
  } else if (rule.phase === "momentum") {
    const longTrend = signalBar.ema30 > signalBar.ema200;
    const shortTrend = signalBar.ema30 < signalBar.ema200;
    if (longTrend && down[signalIndex] && noRecentSignal(down, signalIndex, recentLookback) && passesEchoFilters(signalBar, LONG, rule)) {
      side = LONG;
    } else if (
      shortTrend &&
      up[signalIndex] &&
      noRecentSignal(up, signalIndex, recentLookback) &&
      passesEchoFilters(signalBar, SHORT, rule)
    ) {
      side = SHORT;
    }
  }

  if (!side) return null;

  const confidence = echoModelScore(rule, bars, signalIndex, side);
  if (rule.echoModel && (confidence === null || confidence < rule.echoModel.threshold)) return null;

  const direction = side === LONG ? 1 : -1;
  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const takeProfitPrice = roundToTick(entryPrice + direction * rule.tpUnits * rule.tickSize, rule.tickSize);
  const stopLossPrice = roundToTick(entryPrice - direction * rule.slUnits * rule.tickSize, rule.tickSize);
  return {
    side,
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
    tpUnits: rule.tpUnits,
    slUnits: rule.slUnits,
    signalTime: signalBar.time,
    ...(confidence === null ? {} : { confidence, score: confidence })
  };
}
