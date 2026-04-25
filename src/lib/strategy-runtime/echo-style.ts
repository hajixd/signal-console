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
    signalTime: signalBar.time
  };
}
