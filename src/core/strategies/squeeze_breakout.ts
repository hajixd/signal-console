import type { EnrichedBar } from "@/lib/indicators";
import type { StrategyRule } from "@/lib/types";
import { LONG } from "@/core/strategies/shared/constants";
import { roundToTick } from "@/core/strategies/shared/evaluator";

export function evaluateSqueezeBreakout(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number) {
  const signalBar = bars[signalIndex];
  if (!signalBar || signalBar.bbWidthPct200 === null || signalBar.priorHigh55 === null) return null;
  if (signalBar.bbWidthPct200 > (rule.squeezeThreshold ?? 0.25) || signalBar.close <= signalBar.priorHigh55) return null;

  const atrUnits = Math.max((signalBar.atr100 ?? rule.tickSize * 100) / rule.tickSize, 1);
  const tpUnits = Math.round(atrUnits * 3);
  const slUnits = Math.round(atrUnits * 1.5);
  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  return {
    side: LONG,
    entryPrice,
    takeProfitPrice: roundToTick(entryPrice + tpUnits * rule.tickSize, rule.tickSize),
    stopLossPrice: roundToTick(entryPrice - slUnits * rule.tickSize, rule.tickSize),
    tpUnits,
    slUnits,
    signalTime: signalBar.time
  };
}
