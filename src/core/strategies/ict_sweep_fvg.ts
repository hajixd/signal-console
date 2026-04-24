import type { EnrichedBar } from "@/lib/indicators";
import type { Side, StrategyRule } from "@/lib/types";
import { LONG, SHORT } from "@/core/strategies/shared/constants";
import { priorDayRange, roundToTick } from "@/core/strategies/shared/evaluator";

export function evaluateIctSweepFvg(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number) {
  for (let sweepIndex = Math.max(100, signalIndex - 24); sweepIndex <= signalIndex - 2; sweepIndex += 1) {
    const sweepBar = bars[sweepIndex]!;
    const range = priorDayRange(bars, sweepIndex);
    const atr = sweepBar.atr100;
    if (!range || !atr) continue;

    let side: Side | null = null;
    let sweepExtreme = 0;
    if (sweepBar.high > range.high + rule.tickSize && sweepBar.close < range.high) {
      side = SHORT;
      sweepExtreme = sweepBar.high;
    } else if (sweepBar.low < range.low - rule.tickSize && sweepBar.close > range.low) {
      side = LONG;
      sweepExtreme = sweepBar.low;
    }
    if (!side) continue;

    for (let displacementIndex = sweepIndex + 1; displacementIndex <= Math.min(sweepIndex + 4, signalIndex - 1); displacementIndex += 1) {
      const displacement = bars[displacementIndex]!;
      const body = Math.abs(displacement.close - displacement.open);
      const bearishFvg = bars[displacementIndex]!.high < bars[displacementIndex - 2]!.low;
      const bullishFvg = bars[displacementIndex]!.low > bars[displacementIndex - 2]!.high;
      const isBear = side === SHORT && displacement.close < displacement.open && displacement.close < range.high && body > 0.35 * atr && bearishFvg;
      const isBull = side === LONG && displacement.close > displacement.open && displacement.close > range.low && body > 0.35 * atr && bullishFvg;
      if (!isBear && !isBull) continue;

      const impulse = bars.slice(sweepIndex, displacementIndex + 1);
      const impulseHigh = Math.max(...impulse.map((bar) => bar.high));
      const impulseLow = Math.min(...impulse.map((bar) => bar.low));
      const entryPrice =
        side === SHORT
          ? roundToTick(impulseLow + (impulseHigh - impulseLow) * 0.705, rule.tickSize)
          : roundToTick(impulseHigh - (impulseHigh - impulseLow) * 0.705, rule.tickSize);
      const stopLossPrice =
        side === SHORT ? roundToTick(sweepExtreme + rule.tickSize, rule.tickSize) : roundToTick(sweepExtreme - rule.tickSize, rule.tickSize);
      if ((side === SHORT && entryPrice >= stopLossPrice) || (side === LONG && entryPrice <= stopLossPrice)) continue;

      const latest = bars[signalIndex]!;
      const filled = side === SHORT ? latest.high >= entryPrice : latest.low <= entryPrice;
      if (!filled || signalIndex > displacementIndex + 16) continue;

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
        signalTime: latest.time,
        entryMode: "ICT OTE limit fill after prior-day high/low sweep + FVG displacement"
      };
    }
  }
  return null;
}
