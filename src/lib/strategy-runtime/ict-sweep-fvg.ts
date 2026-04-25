import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { StrategyRule } from "@/lib/types";
import { LONG, SHORT } from "./constants";
import { priorDayRange, roundToTick } from "./helpers";

export function evaluateIctSweepFvg(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number): StrategySignal | null {
  const displacement = bars[signalIndex];
  if (!displacement) return null;

  for (let sweepIndex = Math.max(100, signalIndex - 4); sweepIndex <= signalIndex - 1; sweepIndex += 1) {
    const sweepBar = bars[sweepIndex]!;
    const range = priorDayRange(bars, sweepIndex);
    const atr = sweepBar.atr100;
    if (!range || !atr) continue;

    let side: "long" | "short" | null = null;
    let sweepExtreme = 0;
    if (sweepBar.high > range.high + rule.tickSize && sweepBar.close < range.high) {
      side = SHORT;
      sweepExtreme = sweepBar.high;
    } else if (sweepBar.low < range.low - rule.tickSize && sweepBar.close > range.low) {
      side = LONG;
      sweepExtreme = sweepBar.low;
    }
    if (!side) continue;

    const body = Math.abs(displacement.close - displacement.open);
    const bearishFvg = signalIndex >= 2 && displacement.high < bars[signalIndex - 2]!.low;
    const bullishFvg = signalIndex >= 2 && displacement.low > bars[signalIndex - 2]!.high;
    const isBear =
      side === SHORT &&
      displacement.close < displacement.open &&
      displacement.close < range.high &&
      body > 0.35 * atr &&
      bearishFvg;
    const isBull =
      side === LONG &&
      displacement.close > displacement.open &&
      displacement.close > range.low &&
      body > 0.35 * atr &&
      bullishFvg;
    if (!isBear && !isBull) continue;

    const impulse = bars.slice(sweepIndex, signalIndex + 1);
    const impulseHigh = Math.max(...impulse.map((bar) => bar.high));
    const impulseLow = Math.min(...impulse.map((bar) => bar.low));
    const entryPrice =
      side === SHORT
        ? roundToTick(impulseLow + (impulseHigh - impulseLow) * 0.705, rule.tickSize)
        : roundToTick(impulseHigh - (impulseHigh - impulseLow) * 0.705, rule.tickSize);
    const stopLossPrice =
      side === SHORT ? roundToTick(sweepExtreme + rule.tickSize, rule.tickSize) : roundToTick(sweepExtreme - rule.tickSize, rule.tickSize);
    if ((side === SHORT && entryPrice >= stopLossPrice) || (side === LONG && entryPrice <= stopLossPrice)) continue;

    const slUnits = Math.abs(entryPrice - stopLossPrice) / rule.tickSize;
    const tpUnits = slUnits * (rule.ictRiskReward ?? 1);
    const takeProfitPrice =
      side === SHORT
        ? roundToTick(entryPrice - tpUnits * rule.tickSize, rule.tickSize)
        : roundToTick(entryPrice + tpUnits * rule.tickSize, rule.tickSize);
    return {
      side,
      entryPrice,
      takeProfitPrice,
      stopLossPrice,
      tpUnits,
      slUnits,
      signalTime: displacement.time,
      entryType: "limit",
      entryMode: "ICT OTE limit order activates next 15m bar after sweep + FVG displacement"
    };
  }

  return null;
}
