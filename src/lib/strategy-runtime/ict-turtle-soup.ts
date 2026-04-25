import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { StrategyRule } from "@/lib/types";
import { LONG, SHORT } from "./constants";
import { allowedByTrend, priorDayRange, roundToTick, sessionMinutes } from "./helpers";
import { strategyRuntimeConfig } from "./runtime-config";

export function evaluateIctTurtleSoup(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number): StrategySignal | null {
  const signalBar = bars[signalIndex];
  if (!signalBar || signalBar.atr14 === null) return null;

  const config = strategyRuntimeConfig(rule.variantId);
  const session = sessionMinutes(config);
  if (signalBar.nyMinutes < session.start || signalBar.nyMinutes > session.end) return null;

  const priorRange = priorDayRange(bars, signalIndex);
  if (!priorRange) return null;

  let side: "long" | "short" | null = null;
  let stopLossPrice = 0;
  if (
    signalBar.high > priorRange.high &&
    signalBar.close < priorRange.high &&
    signalBar.high - priorRange.high >= signalBar.atr14 * config.threshold
  ) {
    side = SHORT;
    stopLossPrice = signalBar.high + signalBar.atr14 * 0.08;
  } else if (
    signalBar.low < priorRange.low &&
    signalBar.close > priorRange.low &&
    priorRange.low - signalBar.low >= signalBar.atr14 * config.threshold
  ) {
    side = LONG;
    stopLossPrice = signalBar.low - signalBar.atr14 * 0.08;
  }

  if (!side || !allowedByTrend(signalBar, side, config.trend)) return null;

  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  stopLossPrice = roundToTick(stopLossPrice, rule.tickSize);
  const risk = Math.abs(entryPrice - stopLossPrice);
  if (risk <= signalBar.atr14 * 0.05) return null;
  const takeProfitPrice = roundToTick(entryPrice + (side === LONG ? 1 : -1) * risk * config.rr, rule.tickSize);
  return {
    side,
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
    tpUnits: Math.abs(takeProfitPrice - entryPrice) / rule.tickSize,
    slUnits: Math.abs(entryPrice - stopLossPrice) / rule.tickSize,
    signalTime: signalBar.time
  };
}
