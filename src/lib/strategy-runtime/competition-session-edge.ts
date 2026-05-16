import type { EnrichedBar } from "@/lib/indicators";
import type { StrategySignal } from "@/lib/strategy-definition";
import type { StrategyRule } from "@/lib/types";
import { roundToTick } from "./helpers";

type Params = Record<string, string>;

function variantParams(variantId: string | undefined): Params {
  const params: Params = {};
  for (const token of (variantId ?? "").split("|")) {
    const [key, value] = token.split("=", 2);
    if (key && value !== undefined) params[key] = value;
  }
  return params;
}

function num(params: Params, key: string, fallback: number): number {
  const parsed = Number(params[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sideText(side: number): "long" | "short" {
  return side === 1 ? "long" : "short";
}

function passesFilters(params: Params, bar: EnrichedBar, side: number): boolean {
  const weekday = params.signal_weekday;
  if (weekday !== undefined && bar.nyWeekday !== Number(weekday)) return false;

  const sideFilter = params.side_filter;
  if (sideFilter === "long" && side !== 1) return false;
  if (sideFilter === "short" && side !== -1) return false;

  const weekdaySide = params.signal_weekday_side;
  if (weekdaySide) {
    const [rawWeekday, rawSide] = weekdaySide.split("_", 2);
    if (rawWeekday !== undefined && rawWeekday !== "" && bar.nyWeekday !== Number(rawWeekday)) return false;
    if (rawSide === "long" && side !== 1) return false;
    if (rawSide === "short" && side !== -1) return false;
  }

  const signalMonth = params.signal_month;
  if (signalMonth !== undefined) {
    const month = Number(bar.nyDate.slice(5, 7));
    if (month !== Number(signalMonth)) return false;
  }

  return true;
}

function barAtDayMinute(bars: EnrichedBar[], day: string, minute: number): { bar: EnrichedBar; index: number } | null {
  const index = bars.findIndex((bar) => bar.nyDate === day && bar.nyMinutes === minute);
  return index >= 0 ? { bar: bars[index]!, index } : null;
}

function previousTradingDay(bars: EnrichedBar[], day: string): string | null {
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const bar = bars[index]!;
    if (bar.nyDate < day) return bar.nyDate;
  }
  return null;
}

function previousCloseBar(bars: EnrichedBar[], day: string): EnrichedBar | null {
  const previousDay = previousTradingDay(bars, day);
  if (!previousDay) return null;
  return barAtDayMinute(bars, previousDay, 945)?.bar ?? null;
}

function safeAtr(bar: EnrichedBar, rule: StrategyRule): number {
  return bar.atr14 && bar.atr14 > 0 ? bar.atr14 : Math.max(bar.high - bar.low, rule.tickSize * 10);
}

function signalFromRisk(
  rule: StrategyRule,
  bar: EnrichedBar,
  side: number,
  risk: number,
  notes: string,
  entryPriceOverride?: number
): StrategySignal {
  const entryPrice = roundToTick(entryPriceOverride ?? bar.close, rule.tickSize);
  const stopLossPrice = roundToTick(entryPrice - side * risk, rule.tickSize);
  const takeProfitPrice = roundToTick(entryPrice + side * risk * 3, rule.tickSize);
  return {
    side: sideText(side),
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    tpUnits: Math.abs(takeProfitPrice - entryPrice) / rule.tickSize,
    slUnits: Math.abs(entryPrice - stopLossPrice) / rule.tickSize,
    signalTime: bar.time,
    notes
  };
}

function overnightSignal(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number, params: Params): StrategySignal | null {
  const bar = bars[signalIndex];
  if (!bar || bar.nyMinutes !== 945) return null;
  const side = params.side === "short" ? -1 : 1;
  if (!passesFilters(params, bar, side)) return null;
  return signalFromRisk(rule, bar, side, safeAtr(bar, rule), "Competition session edge: overnight close-to-open bias.");
}

function gapSignal(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number, params: Params): StrategySignal | null {
  const bar = bars[signalIndex];
  if (!bar) return null;
  const entryMinute = num(params, "entry", 570);
  if (bar.nyMinutes !== entryMinute) return null;
  const previousClose = previousCloseBar(bars, bar.nyDate);
  if (!previousClose) return null;
  const gap = bar.open - previousClose.close;
  if (gap === 0) return null;
  const atr = safeAtr(previousClose, rule);
  if (Math.abs(gap) / atr < num(params, "min_gap_atr", 0)) return null;
  const direction = params.direction === "fade" ? -1 : 1;
  const side = (gap > 0 ? 1 : -1) * direction;
  if (!passesFilters(params, previousClose, side)) return null;
  return signalFromRisk(rule, bar, side, safeAtr(bar, rule), "Competition session edge: NY open gap.", bar.open);
}

function intradaySignal(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number, params: Params): StrategySignal | null {
  const bar = bars[signalIndex];
  if (!bar) return null;
  const signalStart = num(params, "signal_start", 570);
  const signalEnd = num(params, "signal_end", 585);
  const entryMinute = num(params, "entry", 930);
  if (bar.nyMinutes !== entryMinute - 15) return null;
  const start = barAtDayMinute(bars, bar.nyDate, signalStart);
  const end = barAtDayMinute(bars, bar.nyDate, signalEnd);
  if (!start || !end) return null;
  const move = end.bar.close - start.bar.open;
  if (move === 0) return null;
  const atr = safeAtr(end.bar, rule);
  if (Math.abs(move) / atr < num(params, "min_signal_atr", 0)) return null;
  const direction = params.direction === "opposite" || params.direction === "fade" || params.direction === "contrarian" ? -1 : 1;
  const side = (move > 0 ? 1 : -1) * direction;
  if (!passesFilters(params, end.bar, side)) return null;
  return signalFromRisk(rule, bar, side, safeAtr(bar, rule), "Competition session edge: scheduled intraday entry.");
}

function dailySignal(rule: StrategyRule, bars: EnrichedBar[], signalIndex: number, params: Params): StrategySignal | null {
  const bar = bars[signalIndex];
  if (!bar) return null;
  const family = params.family ?? "";
  const overnight = family.startsWith("daily_tsmom_next_overnight");
  const entryMinute = num(params, "entry", overnight ? 945 : 570);
  if (bar.nyMinutes !== (overnight ? entryMinute : entryMinute - 15)) return null;

  const closeBars = bars.filter((item) => item.nyMinutes === 945);
  const currentCloseIndex = closeBars.findIndex((item) => item.nyDate === (overnight ? bar.nyDate : previousTradingDay(bars, bar.nyDate)));
  const lookback = num(params, "lookback", 3);
  if (currentCloseIndex < lookback) return null;
  const current = closeBars[currentCloseIndex]!;
  const past = closeBars[currentCloseIndex - lookback]!;
  const move = current.close - past.close;
  if (move === 0) return null;
  const direction = params.direction === "contrarian" ? -1 : 1;
  const side = (move > 0 ? 1 : -1) * direction;
  if (!passesFilters(params, current, side)) return null;
  return signalFromRisk(rule, bar, side, safeAtr(bar, rule), "Competition session edge: daily time-series momentum.");
}

export function evaluateCompetitionSessionEdge(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number
): StrategySignal | null {
  const params = variantParams(rule.variantId);
  const family = params.family ?? "";
  if (family.startsWith("daily_tsmom")) return dailySignal(rule, bars, signalIndex, params);
  if (family.startsWith("overnight_close_to_open")) return overnightSignal(rule, bars, signalIndex, params);
  if (family.startsWith("ny_open_gap")) return gapSignal(rule, bars, signalIndex, params);
  if (family.startsWith("us_") || family.startsWith("london_first30")) {
    return intradaySignal(rule, bars, signalIndex, params);
  }
  return null;
}
