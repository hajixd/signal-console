import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { StrategyRule } from "@/lib/types";
import { LONG, SHORT } from "./constants";
import { allowedByTrend, orbWindowForLatest, roundToTick } from "./helpers";
import { strategyRuntimeConfig } from "./runtime-config";

export function evaluateRedditOrbBreakout(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number): StrategySignal | null {
  const config = strategyRuntimeConfig(rule.variantId);
  const window = orbWindowForLatest(bars, signalIndex, config);
  if (!window) return null;

  const signalBar = bars[signalIndex]!;
  const rangeBars = bars.slice(window.rangeStart, window.rangeEnd + 1);
  const orHigh = Math.max(...rangeBars.map((bar) => bar.high));
  const orLow = Math.min(...rangeBars.map((bar) => bar.low));
  const orRange = orHigh - orLow;
  const atr = bars[window.rangeEnd]!.atr14;
  if (!atr || orRange < atr * 0.15 || orRange > atr * 3.5) return null;

  const side = signalBar.close > orHigh ? LONG : signalBar.close < orLow ? SHORT : null;
  if (!side || !allowedByTrend(signalBar, side, config.trend)) return null;

  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const stopLossPrice = roundToTick(side === LONG ? orLow : orHigh, rule.tickSize);
  const risk = Math.abs(entryPrice - stopLossPrice);
  if (risk <= 0) return null;
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
