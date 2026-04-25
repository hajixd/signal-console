import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { StrategyRule } from "@/lib/types";
import { LONG, SHORT } from "./constants";
import { allowedByTrend, orbWindowForLatest, roundToTick } from "./helpers";
import { strategyRuntimeConfig } from "./runtime-config";

export function evaluateRedditOrbRetest(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number): StrategySignal | null {
  const config = strategyRuntimeConfig(rule.variantId);
  const window = orbWindowForLatest(bars, signalIndex, config);
  if (!window) return null;

  const rangeBars = bars.slice(window.rangeStart, window.rangeEnd + 1);
  const orHigh = Math.max(...rangeBars.map((bar) => bar.high));
  const orLow = Math.min(...rangeBars.map((bar) => bar.low));
  const orRange = orHigh - orLow;
  const atr = bars[window.rangeEnd]!.atr14;
  if (!atr || orRange < atr * 0.15 || orRange > atr * 3.5) return null;

  let breakoutSide: "long" | "short" | null = null;
  let breakoutLevel = 0;
  let breakoutIndex = -1;

  for (let index = window.entryStart; index <= signalIndex; index += 1) {
    const bar = bars[index]!;
    if (!breakoutSide) {
      const side = bar.close > orHigh ? LONG : bar.close < orLow ? SHORT : null;
      if (!side || !allowedByTrend(bar, side, config.trend)) continue;
      breakoutSide = side;
      breakoutLevel = side === LONG ? orHigh : orLow;
      breakoutIndex = index;
      continue;
    }

    if (index - breakoutIndex > 8) return null;

    const touched = bar.low <= breakoutLevel && breakoutLevel <= bar.high;
    const confirmed = breakoutSide === LONG ? bar.close > breakoutLevel : bar.close < breakoutLevel;
    if (!touched || !confirmed) continue;
    if (index !== signalIndex) return null;

    const entryPrice = roundToTick(bar.close, rule.tickSize);
    const stopLossPrice = roundToTick(
      breakoutSide === LONG ? Math.min(bar.low, orLow) : Math.max(bar.high, orHigh),
      rule.tickSize
    );
    const risk = Math.abs(entryPrice - stopLossPrice);
    if (risk <= 0) return null;
    const takeProfitPrice = roundToTick(entryPrice + (breakoutSide === LONG ? 1 : -1) * risk * config.rr, rule.tickSize);
    return {
      side: breakoutSide,
      entryPrice,
      takeProfitPrice,
      stopLossPrice,
      tpUnits: Math.abs(takeProfitPrice - entryPrice) / rule.tickSize,
      slUnits: Math.abs(entryPrice - stopLossPrice) / rule.tickSize,
      signalTime: bar.time
    };
  }

  return null;
}
