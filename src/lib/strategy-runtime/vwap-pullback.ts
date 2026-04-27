import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { StrategyRule } from "@/lib/types";
import { LONG, SHORT } from "./constants";
import { allowedByTrend, roundToTick, sessionMinutes } from "./helpers";
import { strategyRuntimeConfig } from "./runtime-config";

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildRiskRewardSignal(
  rule: StrategyRule,
  signalBar: EnrichedBar,
  side: "long" | "short",
  entryPrice: number,
  stopLossPrice: number,
  riskReward: number,
  notes?: string
): StrategySignal | null {
  const risk = Math.abs(entryPrice - stopLossPrice);
  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }

  const direction = side === LONG ? 1 : -1;
  const takeProfitPrice = roundToTick(entryPrice + direction * risk * riskReward, rule.tickSize);
  return {
    side,
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
    tpUnits: Math.abs(takeProfitPrice - entryPrice) / rule.tickSize,
    slUnits: risk / rule.tickSize,
    signalTime: signalBar.time,
    entryType: "market",
    stopLossMode: "price",
    takeProfitMode: "risk_multiple",
    riskReward,
    notes
  };
}

export function evaluateVwapPullback(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number
): StrategySignal | null {
  const signalBar = bars[signalIndex];
  const priorBar = bars[signalIndex - 1];
  if (
    !signalBar ||
    !priorBar ||
    !isFiniteNumber(signalBar.atr14) ||
    !isFiniteNumber(signalBar.sessionVwap) ||
    !isFiniteNumber(signalBar.ema30) ||
    !isFiniteNumber(signalBar.ema200) ||
    !isFiniteNumber(signalBar.bodyAtr)
  ) {
    return null;
  }

  const config = strategyRuntimeConfig(rule.variantId);
  const session = sessionMinutes(config);
  if (signalBar.nyMinutes < session.start || signalBar.nyMinutes > session.end) {
    return null;
  }
  if (signalBar.nyMinutes < session.start + 30) {
    return null;
  }

  const atr = signalBar.atr14;
  const vwap = signalBar.sessionVwap;
  const proximity = Math.max(0.05, config.threshold);
  const hadUpDrive = priorBar.close > vwap + atr * proximity;
  const hadDownDrive = priorBar.close < vwap - atr * proximity;

  const longSetup =
    hadUpDrive &&
    signalBar.ema30 >= signalBar.ema200 &&
    signalBar.low <= vwap + atr * proximity &&
    signalBar.close > vwap &&
    signalBar.bodyAtr > -0.1;
  const shortSetup =
    hadDownDrive &&
    signalBar.ema30 <= signalBar.ema200 &&
    signalBar.high >= vwap - atr * proximity &&
    signalBar.close < vwap &&
    signalBar.bodyAtr < 0.1;

  const side = longSetup ? LONG : shortSetup ? SHORT : null;
  if (!side || !allowedByTrend(signalBar, side, config.trend)) {
    return null;
  }

  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const stopDistance = Math.max(Math.abs(entryPrice - vwap) + atr * 0.15, atr * config.slAtr * 0.35);
  const stopLossPrice = roundToTick(entryPrice - (side === LONG ? 1 : -1) * stopDistance, rule.tickSize);
  return buildRiskRewardSignal(
    rule,
    signalBar,
    side,
    entryPrice,
    stopLossPrice,
    config.rr,
    "VWAP pullback proxy: trend-confirmed drive away from VWAP, reclaim/retest entry, and ATR-buffered stop."
  );
}
