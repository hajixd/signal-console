import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { StrategyRule } from "@/lib/types";
import { LONG, SHORT } from "./constants";
import { allowedByTrend, roundToTick, sessionMinutes } from "./helpers";
import { strategyRuntimeConfig } from "./runtime-config";

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function evaluateTrendlineBreak(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number
): StrategySignal | null {
  const signalBar = bars[signalIndex];
  if (!signalBar || !isFiniteNumber(signalBar.atr14) || !isFiniteNumber(signalBar.ema50) || !isFiniteNumber(signalBar.ema200)) {
    return null;
  }

  const config = strategyRuntimeConfig(rule.variantId);
  const session = sessionMinutes(config);
  if (signalBar.nyMinutes < session.start || signalBar.nyMinutes > session.end) {
    return null;
  }

  const lookback = Math.max(48, Math.trunc(config.rangeMinutes));
  const triggerWindow = Math.max(8, Math.min(32, Math.trunc(config.entryMinutes / 15)));
  if (signalIndex < lookback + triggerWindow + 1) {
    return null;
  }

  const priorStart = signalIndex - lookback;
  const recentStart = signalIndex - triggerWindow;
  const priorBars = bars.slice(priorStart, recentStart);
  const recentBars = bars.slice(recentStart, signalIndex);
  const recentBarsWithSignal = bars.slice(recentStart, signalIndex + 1);
  if (!priorBars.length || !recentBars.length || !recentBarsWithSignal.length) {
    return null;
  }

  const priorHigh = Math.max(...priorBars.map((bar) => bar.high));
  const priorLow = Math.min(...priorBars.map((bar) => bar.low));
  const recentHigh = Math.max(...recentBars.map((bar) => bar.high));
  const recentLow = Math.min(...recentBars.map((bar) => bar.low));
  const atr = signalBar.atr14;
  const buffer = atr * Math.max(0.02, config.threshold);

  const priorStartBar = bars[priorStart];
  const recentStartBar = bars[recentStart];
  if (!priorStartBar || !recentStartBar) {
    return null;
  }

  const downStructure = priorStartBar.close > recentStartBar.close && recentHigh <= priorHigh + atr * 0.25;
  const upStructure = priorStartBar.close < recentStartBar.close && recentLow >= priorLow - atr * 0.25;
  const longSetup = downStructure && signalBar.close > recentHigh + buffer && signalBar.close > signalBar.ema50;
  const shortSetup = upStructure && signalBar.close < recentLow - buffer && signalBar.close < signalBar.ema50;

  const side = longSetup ? LONG : shortSetup ? SHORT : null;
  if (!side || !allowedByTrend(signalBar, side, config.trend)) {
    return null;
  }

  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const recentExtreme = side === LONG ? Math.min(...recentBarsWithSignal.map((bar) => bar.low)) : Math.max(...recentBarsWithSignal.map((bar) => bar.high));
  const stopLossPrice = roundToTick(
    side === LONG ? recentExtreme - atr * config.slAtr * 0.15 : recentExtreme + atr * config.slAtr * 0.15,
    rule.tickSize
  );
  const risk = Math.abs(entryPrice - stopLossPrice);
  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }

  const direction = side === LONG ? 1 : -1;
  const takeProfitPrice = roundToTick(entryPrice + direction * risk * config.rr, rule.tickSize);
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
    riskReward: config.rr,
    notes:
      "Trendline-break proxy: broad structure break, low-risk opposing structure stop, and no prior-bar trailing because it underperformed the safety-line concept in backtests."
  };
}
