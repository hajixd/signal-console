import type { EnrichedBar } from "@/lib/indicators";
import type { StrategyRule } from "@/lib/types";
import { LONG, SHORT } from "@/core/strategies/shared/constants";
import { roundToTick } from "@/core/strategies/shared/evaluator";
import { strategyRuntimeConfig } from "@/core/strategies/shared/runtime-config";

export function evaluateRedditCapitulationReversion(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number) {
  const signalBar = bars[signalIndex];
  if (!signalBar || signalBar.nyMinutes < 9 * 60 + 30 || signalBar.nyMinutes > 15 * 60) return null;
  if (
    signalBar.ema50 === null ||
    signalBar.ema200 === null ||
    signalBar.ret3Atr === null ||
    signalBar.bbZ20 === null ||
    signalBar.closeLocation === null ||
    signalBar.rsi2 === null
  ) {
    return null;
  }

  const config = strategyRuntimeConfig(rule.variantId);
  const longSetup =
    signalBar.close > signalBar.ema200 &&
    signalBar.ema50 > signalBar.ema200 &&
    signalBar.ret3Atr <= -config.threshold &&
    signalBar.bbZ20 <= -1.75 &&
    signalBar.closeLocation <= 0.35 &&
    (config.rsi2Max === undefined || signalBar.rsi2 <= config.rsi2Max);
  const shortSetup =
    config.trend === "both" &&
    signalBar.close < signalBar.ema200 &&
    signalBar.ema50 < signalBar.ema200 &&
    signalBar.ret3Atr >= config.threshold &&
    signalBar.bbZ20 >= 1.75 &&
    signalBar.closeLocation >= 0.65 &&
    (config.rsi2Max === undefined || signalBar.rsi2 >= 100 - config.rsi2Max);

  const side = longSetup ? LONG : shortSetup ? SHORT : null;
  if (!side) return null;

  const direction = side === LONG ? 1 : -1;
  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const stopDistance = entryPrice * 0.003;
  const stopLossPrice = roundToTick(entryPrice - direction * stopDistance, rule.tickSize);
  const takeProfitPrice = roundToTick(entryPrice + direction * stopDistance * config.rr, rule.tickSize);
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
