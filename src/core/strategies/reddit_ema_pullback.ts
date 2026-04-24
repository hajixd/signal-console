import type { EnrichedBar } from "@/lib/indicators";
import type { StrategyRule } from "@/lib/types";
import { LONG, SHORT, SESSION_OPEN_ET } from "@/core/strategies/shared/constants";
import { roundToTick } from "@/core/strategies/shared/evaluator";
import { strategyRuntimeConfig } from "@/core/strategies/shared/runtime-config";

export function evaluateRedditEmaPullback(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number) {
  const signalBar = bars[signalIndex];
  if (
    !signalBar ||
    signalBar.ema9 === null ||
    signalBar.ema21 === null ||
    signalBar.ema34 === null ||
    signalBar.ema50 === null ||
    signalBar.ema200 === null ||
    signalBar.atr14 === null ||
    signalBar.bodyAtr === null
  ) {
    return null;
  }

  const config = strategyRuntimeConfig(rule.variantId);
  const openMinutes = config.session === "all" ? SESSION_OPEN_ET.ny : config.session === "pre_ny" ? SESSION_OPEN_ET.pre_ny : SESSION_OPEN_ET[config.session];
  const sessionEnd = Math.min(openMinutes + 210, 15 * 60);
  if (signalBar.nyMinutes < openMinutes || signalBar.nyMinutes > sessionEnd) return null;

  const longSetup =
    signalBar.ema21 > signalBar.ema50 &&
    signalBar.ema50 > signalBar.ema200 &&
    signalBar.low <= signalBar.ema21 &&
    signalBar.close > signalBar.ema9 &&
    signalBar.bodyAtr > 0;
  const shortSetup =
    signalBar.ema21 < signalBar.ema50 &&
    signalBar.ema50 < signalBar.ema200 &&
    signalBar.high >= signalBar.ema21 &&
    signalBar.close < signalBar.ema9 &&
    signalBar.bodyAtr < 0;

  const side = longSetup ? LONG : shortSetup ? SHORT : null;
  if (!side) return null;

  const direction = side === LONG ? 1 : -1;
  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const stopDistance = Math.max(config.slAtr * signalBar.atr14, Math.abs(entryPrice - signalBar.ema34));
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) return null;
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
