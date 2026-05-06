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

export function evaluateSupportResistanceRetest(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number
): StrategySignal | null {
  const signalBar = bars[signalIndex];
  if (!signalBar || !isFiniteNumber(signalBar.atr14)) {
    return null;
  }

  const config = strategyRuntimeConfig(rule.variantId);
  const session = sessionMinutes(config);
  if (signalBar.nyMinutes < session.start || signalBar.nyMinutes > session.end) {
    return null;
  }

  const lookback = Math.max(12, Math.trunc(config.rangeMinutes));
  const retestBars = Math.max(2, Math.min(24, Math.trunc(config.entryMinutes / 15)));
  if (signalIndex < lookback + retestBars + 2) {
    return null;
  }

  const baseStart = signalIndex - lookback - retestBars;
  const baseEnd = signalIndex - retestBars;
  const recentStart = signalIndex - retestBars;
  const baseBars = bars.slice(baseStart, baseEnd);
  const recentBars = bars.slice(recentStart, signalIndex);
  if (!baseBars.length || !recentBars.length) {
    return null;
  }

  const resistance = Math.max(...baseBars.map((bar) => bar.high));
  const support = Math.min(...baseBars.map((bar) => bar.low));
  const atr = signalBar.atr14;
  const breakoutBuffer = atr * Math.max(0.02, config.threshold);
  const retestBuffer = atr * Math.max(0.05, config.threshold * 1.5);

  const longBreak = Math.max(...recentBars.map((bar) => bar.close)) > resistance + breakoutBuffer;
  const shortBreak = Math.min(...recentBars.map((bar) => bar.close)) < support - breakoutBuffer;
  const longSetup = longBreak && signalBar.low <= resistance + retestBuffer && signalBar.close > resistance;
  const shortSetup = shortBreak && signalBar.high >= support - retestBuffer && signalBar.close < support;

  const side = longSetup ? LONG : shortSetup ? SHORT : null;
  if (!side || !allowedByTrend(signalBar, side, config.trend)) {
    return null;
  }

  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const stopLossPrice = roundToTick(
    side === LONG
      ? Math.min(signalBar.low, resistance - atr * config.slAtr * 0.25)
      : Math.max(signalBar.high, support + atr * config.slAtr * 0.25),
    rule.tickSize
  );
  return buildRiskRewardSignal(
    rule,
    signalBar,
    side,
    entryPrice,
    stopLossPrice,
    config.rr,
    "Support/resistance retest proxy: shelf breakout, pullback confirmation, and breakout-failure stop."
  );
}
