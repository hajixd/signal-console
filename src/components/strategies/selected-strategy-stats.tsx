"use client";

import { useState, type ReactNode } from "react";
import {
  strategyContractScale,
  type StrategyEditOption,
  type StrategyEditSeedMap,
  useStrategyEdits
} from "@/components/strategies/strategy-edits-store";
import { LocalDateTimeStack } from "@/components/ui/local-date-time";

type BasketTrade = {
  key: string;
  lockedSize?: boolean;
  signalTime?: string;
  entryTime: string;
  exitTime: string;
  barsHeld: number;
  basePnlDollars: number;
  baseRiskDollars: number;
  baseTargetDollars: number;
  rMultiple: number;
  symbol?: string;
  market?: string;
  phase?: string;
  label?: string;
  side?: "long" | "short";
  exitReason?: string;
};

type DailyCurvePoint = {
  dayKey: string;
  pnl: number;
  equity: number;
  drawdown: number;
};

type StrategyStatsOption = StrategyEditOption & {
  market?: string;
  timeframeLabel?: string;
  liveSupported?: boolean;
};

type TradeSnapshot = BasketTrade & {
  entryMs: number;
  exitMs: number;
  pnlDollars: number;
  riskDollars: number;
  targetDollars: number;
  durationMs: number;
  strategyLabel: string;
  symbolLabel: string;
  marketLabel: string;
  phaseLabel: string;
  sideLabel: string;
  exitBucket: string;
};

type SegmentSummary = {
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalDollars: number;
  avgDollars: number;
  totalR: number;
  avgR: number;
  profitFactor: number;
  sharePct: number;
};

type SegmentRollup = {
  count: number;
  best: SegmentSummary | null;
  worst: SegmentSummary | null;
  largest: SegmentSummary | null;
  largestSharePct: number;
  topThreeSharePct: number;
  effectiveCount: number;
  entropyEffectiveCount: number;
  profitablePct: number;
  profitContributionPct: number;
};

type DollarAggregate = {
  activeDayRatePct: number;
  avgLossDollars: number;
  medianLossDollars: number;
  trades: number;
  breakevens: number;
  avgWinDollars: number;
  medianWinDollars: number;
  avgLossR: number;
  avgWinR: number;
  avgTargetDollars: number;
  medianTargetDollars: number;
  avgRiskDollars: number;
  medianRiskDollars: number;
  consistencyScorePct: number | null;
  wins: number;
  losses: number;
  winRatePct: number;
  lossRatePct: number;
  breakEvenWinRatePct: number;
  edgeOverBreakEvenPct: number;
  kellyPct: number;
  profitFactor: number;
  rProfitFactor: number;
  rewardRiskRatio: number;
  rRewardRiskRatio: number;
  sharpeRatio: number;
  sortinoRatio: number;
  sqn: number;
  totalR: number;
  avgR: number;
  medianR: number;
  stdDevR: number;
  downsideDeviationR: number;
  medianAbsoluteDeviationR: number;
  bestR: number;
  worstR: number;
  p05R: number;
  p10R: number;
  p25R: number;
  p75R: number;
  p90R: number;
  p95R: number;
  cvarLossR: number;
  iqrR: number;
  skewR: number;
  excessKurtosisR: number;
  avgDurationMs: number;
  avgWinDurationMs: number;
  avgLossDurationMs: number;
  medianDurationMs: number;
  durationIqrMs: number;
  durationStdDevMs: number;
  medianWinDurationMs: number;
  medianLossDurationMs: number;
  shortestDurationMs: number;
  avgBarsHeld: number;
  maxBarsHeld: number;
  longestDurationMs: number;
  totalDurationMs: number;
  exposurePct: number;
  avgGapMs: number;
  medianGapMs: number;
  gapIqrMs: number;
  gapStdDevMs: number;
  shortestGapMs: number;
  longestGapMs: number;
  maxConcurrentTrades: number;
  overlapRatePct: number;
  maxTradesPerActiveDay: number;
  tradesPerActiveDay: number;
  maxDailyDrawdownDollars: number;
  maxTradeDrawdownDollars: number;
  maxRunupDollars: number;
  recoveryFactor: number;
  ulcerIndexDollars: number;
  painIndexDollars: number;
  underwaterDaysPct: number;
  equityHighs: number;
  currentDrawdownDollars: number;
  currentUnderwaterDays: number;
  longestUnderwaterDays: number;
  tradeStdDevDollars: number;
  tradeDownsideDeviationDollars: number;
  tradeMedianAbsoluteDeviationDollars: number;
  tradeIqrDollars: number;
  expectancyStdErrorDollars: number;
  expectancyTStat: number;
  expectancyLower95Dollars: number;
  avgDailyDollars: number;
  avgActiveDayDollars: number;
  avgMonthlyDollars: number;
  medianMonthlyDollars: number;
  stdDevMonthlyDollars: number;
  bestMonthDollars: number;
  worstMonthDollars: number;
  bestMonthPeriod: string;
  worstMonthPeriod: string;
  activeMonths: number;
  winningMonths: number;
  losingMonths: number;
  winningMonthRatePct: number;
  monthlyProfitFactor: number;
  medianDailyDollars: number;
  stdDevDailyDollars: number;
  activeWeeks: number;
  avgWeeklyDollars: number;
  winningWeekRatePct: number;
  bestWeekDollars: number;
  worstWeekDollars: number;
  activeQuarters: number;
  avgQuarterlyDollars: number;
  winningQuarterRatePct: number;
  dailyProfitFactor: number;
  bestTradeDollars: number;
  bestDayDollars: number;
  bestThreeTradesDollars: number;
  bestFiveTradesDollars: number;
  bestThreeDaysDollars: number;
  bestFiveDaysDollars: number;
  worstTradeDollars: number;
  worstDayDollars: number;
  worstThreeTradesDollars: number;
  worstFiveTradesDollars: number;
  worstThreeDaysDollars: number;
  worstFiveDaysDollars: number;
  grossWinDollars: number;
  grossLossDollars: number;
  p05TradeDollars: number;
  p10TradeDollars: number;
  p25TradeDollars: number;
  p50TradeDollars: number;
  p75TradeDollars: number;
  p90TradeDollars: number;
  p95TradeDollars: number;
  cvarLossDollars: number;
  cvarWinDollars: number;
  tailRatio: number;
  activeDays: number;
  calendarDays: number;
  winningDays: number;
  losingDays: number;
  winningDayRatePct: number;
  dailyCurve: DailyCurvePoint[];
  totalDollars: number;
  avgDollars: number;
  longestWinStreak: number;
  longestLossStreak: number;
  bestWinStreakDollars: number;
  worstLossStreakDollars: number;
  currentStreakLabel: string;
  currentStreakCount: number;
  avgAfterWinDollars: number;
  avgAfterLossDollars: number;
  winAfterWinPct: number;
  winAfterLossPct: number;
  lagOneCorrelation: number;
  runsCount: number;
  runsZScore: number;
  longestBreakevenStreak: number;
  avgWinToTargetPct: number;
  avgLossToRiskPct: number;
  riskIqrDollars: number;
  targetIqrDollars: number;
  riskCoefficientVariationPct: number;
  targetCoefficientVariationPct: number;
  targetExitCount: number;
  stopExitCount: number;
  otherExitCount: number;
  targetExitRatePct: number;
  stopExitRatePct: number;
  tradesPerDay: number;
  tradesPerWeek: number;
  tradesPerMonth: number;
  tradesPerYear: number;
  start: number | undefined;
  end: number | undefined;
  strategies: SegmentRollup;
  symbols: SegmentRollup;
  markets: SegmentRollup;
  phases: SegmentRollup;
  sides: SegmentRollup;
  weekdays: SegmentRollup;
  entryHours: SegmentRollup;
  months: SegmentRollup;
  exitReasons: SegmentRollup;
  commonExitReason: SegmentSummary | null;
};

type SelectedStrategyStatsProps = {
  customScaleRange?: CustomScaleRangeSeed;
  dataEndAt?: string;
  defaultExpanded?: boolean;
  strategies: StrategyStatsOption[];
  toggleable?: boolean;
  trades: BasketTrade[];
  persistedStrategyEdits?: StrategyEditSeedMap;
};

type StatTone = "tone-up" | "tone-down" | "tone-neutral";

type StatCardData = {
  label: string;
  value: ReactNode;
  tone?: StatTone;
  text?: boolean;
  className?: string;
  title?: string;
};

type ChartDatum = {
  label: string;
  value: number;
  secondary?: number;
  detail?: string;
};

type StatsChartData = {
  title: string;
  subtitle: string;
  chart: ReactNode;
};

type CustomScaleRangeSeed = {
  riskCeiling?: unknown;
  riskFloor?: unknown;
  targetCeiling?: unknown;
  targetFloor?: unknown;
};

type CustomScaleRange = {
  riskCeiling: number;
  riskFloor: number;
  targetCeiling: number;
  targetFloor: number;
};

function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return "inf";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function fmtPct(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value)}%`;
}

function fmtMoney(value: number, signed = false): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  });
  const formatted = formatter.format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

function fmtR(value: number, signed = false): string {
  if (!Number.isFinite(value)) return value > 0 ? "inf R" : "--";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${fmtNumber(value)}R`;
}

function fmtMaybePct(value: number): string {
  return Number.isFinite(value) ? fmtPct(value) : "--";
}

function fmtSignedPct(value: number): string {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${fmtPct(value)}` : "--";
}

function fmtCount(value: number): string {
  return Number.isFinite(value) ? fmtNumber(value) : "--";
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function shortLabel(value: string, maxLength = 22): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3))}...`;
}

function titleCaseToken(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function parseCustomScaleRange(range: CustomScaleRangeSeed | undefined): CustomScaleRange | null {
  if (!range) return null;
  const targetFloor = positiveNumber(range.targetFloor);
  const targetCeiling = positiveNumber(range.targetCeiling);
  const riskFloor = positiveNumber(range.riskFloor);
  const riskCeiling = positiveNumber(range.riskCeiling);

  if (!targetFloor || !targetCeiling || !riskFloor || !riskCeiling) return null;
  if (targetFloor > targetCeiling || riskFloor > riskCeiling) return null;
  return { riskCeiling, riskFloor, targetCeiling, targetFloor };
}

function customRangeScaleForTrade(trade: BasketTrade, range: CustomScaleRange): number {
  const baseTarget = Math.abs(trade.baseTargetDollars);
  const baseRisk = Math.abs(trade.baseRiskDollars);
  if (!(baseTarget > 0) || !(baseRisk > 0)) return 1;

  const scale = Math.min(range.targetCeiling / baseTarget, range.riskCeiling / baseRisk);
  return Number.isFinite(scale) && scale > 0 ? Number(scale.toFixed(6)) : 1;
}

function latestEndDate(dataEndAt: string | undefined, selectedEnd: number | undefined): number | undefined {
  const dataEnd = dataEndAt ? Date.parse(dataEndAt) : Number.NaN;
  const candidates = [dataEnd, selectedEnd ?? Number.NaN].filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(...candidates) : undefined;
}

function statTone(value: number, higherIsGood = true): string {
  if (value === 0) return "tone-neutral";
  const good = higherIsGood ? value > 0 : value < 0;
  return good ? "tone-up" : "tone-down";
}

function ratioTone(value: number, threshold: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "tone-up" : "tone-neutral";
  if (value >= threshold) return "tone-up";
  if (value > 0) return "tone-neutral";
  return "tone-down";
}

function consistencyTone(value: number | null): string {
  if (value == null) return "tone-neutral";
  if (value >= 60) return "tone-up";
  if (value >= 50) return "tone-neutral";
  return "tone-down";
}

function fmtRiskReward(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "1:inf" : "--";
  return value > 0 ? `1:${fmtNumber(value)}` : "--";
}

function fmtDurationMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const totalMinutes = Math.max(1, Math.round(value / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function localDateFromValue(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function localTradeDayKey(value: string): string {
  const date = localDateFromValue(value);
  if (!date) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTradeMonthKey(value: string): string {
  const date = localDateFromValue(value);
  if (!date) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function localTradeWeekKey(value: string): string {
  const date = localDateFromValue(value);
  if (!date) return value;
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - weekday);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function localTradeQuarterKey(value: string): string {
  const date = localDateFromValue(value);
  if (!date) return value;
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
}

function formatTradeMonthKey(value: string): string {
  const [yearValue, monthValue] = value.split("-");
  const year = Number(yearValue);
  const month = Number(monthValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return value;
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function localWeekdayLabel(value: string): string {
  const date = localDateFromValue(value);
  return date ? WEEKDAY_LABELS[date.getDay()] : "Unknown";
}

function localMonthLabel(value: string): string {
  const date = localDateFromValue(value);
  return date ? MONTH_LABELS[date.getMonth()] : "Unknown";
}

function localHourLabel(value: string): string {
  const date = localDateFromValue(value);
  if (!date) return "Unknown";
  return `${String(date.getHours()).padStart(2, "0")}:00`;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return dateKey;
  date.setDate(date.getDate() + days);
  return localTradeDayKey(date.toISOString());
}

function dailyCurvePoints(dailyPnl: Map<string, number>): DailyCurvePoint[] {
  const keys = [...dailyPnl.keys()].sort((left, right) => left.localeCompare(right));
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return [];

  const points: DailyCurvePoint[] = [];
  let equity = 0;
  let peak = 0;
  for (let day = first; day <= last; day = addDays(day, 1)) {
    const pnl = dailyPnl.get(day) ?? 0;
    equity += pnl;
    peak = Math.max(peak, equity);
    points.push({
      dayKey: day,
      pnl,
      equity,
      drawdown: peak - equity
    });
    if (day === last) break;
  }
  return points;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sampleStdDev(values: number[], average: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function downsideDeviation(values: number[]): number {
  if (!values.length) return 0;
  const downsideVariance = values.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, downsideVariance));
}

function medianAbsoluteDeviation(values: number[]): number {
  if (!values.length) return 0;
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function lagOneCorrelation(values: number[]): number {
  if (values.length < 3) return 0;
  const left = values.slice(0, -1);
  const right = values.slice(1);
  const leftMean = mean(left);
  const rightMean = mean(right);
  const numerator = left.reduce((total, value, index) => total + (value - leftMean) * ((right[index] ?? 0) - rightMean), 0);
  const denominator = Math.sqrt(
    left.reduce((total, value) => total + (value - leftMean) ** 2, 0) *
      right.reduce((total, value) => total + (value - rightMean) ** 2, 0)
  );
  return denominator > 0 ? numerator / denominator : 0;
}

function sequenceRuns(values: number[]): { count: number; zScore: number } {
  const signs = values.filter((value) => value !== 0).map((value) => (value > 0 ? 1 : -1));
  if (!signs.length) return { count: 0, zScore: 0 };
  const positive = signs.filter((sign) => sign > 0).length;
  const negative = signs.length - positive;
  let count = 1;
  for (let index = 1; index < signs.length; index += 1) {
    if (signs[index] !== signs[index - 1]) count += 1;
  }
  if (!positive || !negative || signs.length < 2) return { count, zScore: 0 };
  const expected = 1 + (2 * positive * negative) / signs.length;
  const variance =
    (2 * positive * negative * (2 * positive * negative - signs.length)) /
    (signs.length ** 2 * (signs.length - 1));
  return { count, zScore: variance > 0 ? (count - expected) / Math.sqrt(variance) : 0 };
}

function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

function percentile(values: number[], pct: number): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const rank = (Math.max(0, Math.min(100, pct)) / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = rank - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

function tailAverage(values: number[], pct: number, side: "top" | "bottom"): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const count = Math.max(1, Math.ceil(sorted.length * (pct / 100)));
  const tail = side === "top" ? sorted.slice(-count) : sorted.slice(0, count);
  return mean(tail);
}

function skewness(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 3) return 0;
  const average = mean(finite);
  const deviation = sampleStdDev(finite, average);
  if (deviation === 0) return 0;
  return finite.reduce((total, value) => total + ((value - average) / deviation) ** 3, 0) / finite.length;
}

function excessKurtosis(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 4) return 0;
  const average = mean(finite);
  const deviation = sampleStdDev(finite, average);
  if (deviation === 0) return 0;
  return finite.reduce((total, value) => total + ((value - average) / deviation) ** 4, 0) / finite.length - 3;
}

function rollingExtreme(values: number[], windowSize: number, mode: "best" | "worst"): number {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  const size = Math.min(windowSize, finite.length);
  let current = sum(finite.slice(0, size));
  let best = current;
  for (let index = size; index < finite.length; index += 1) {
    current += (finite[index] ?? 0) - (finite[index - size] ?? 0);
    best = mode === "best" ? Math.max(best, current) : Math.min(best, current);
  }
  return best;
}

function annualizedRatio(average: number, deviation: number, periodsPerYear: number): number {
  if (deviation === 0) return average > 0 ? Infinity : 0;
  return (average / deviation) * Math.sqrt(periodsPerYear);
}

function tradeDurationMs(trade: BasketTrade): number {
  const entry = Date.parse(trade.entryTime);
  const exit = Date.parse(trade.exitTime);
  if (Number.isFinite(entry) && Number.isFinite(exit) && exit > entry) return exit - entry;
  return Math.max(0, trade.barsHeld) * 15 * 60_000;
}

type SegmentBucket = {
  label: string;
  trades: number;
  wins: number;
  losses: number;
  totalDollars: number;
  totalAbsDollars: number;
  totalR: number;
  grossWinDollars: number;
  grossLossDollars: number;
};

function exitBucketLabel(reason: string | undefined): string {
  const normalized = (reason ?? "").trim().toLowerCase();
  if (!normalized) return "Unknown";
  if (normalized.includes("target") || normalized.includes("take_profit") || normalized === "tp") return "Target";
  if (normalized.includes("stop") || normalized.includes("stop_loss") || normalized === "sl") return "Stop";
  if (normalized.includes("time") || normalized.includes("close")) return "Time close";
  return titleCaseToken(normalized);
}

function segmentKey(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function addSegment(map: Map<string, SegmentBucket>, key: string, label: string, trade: TradeSnapshot): void {
  const bucket =
    map.get(key) ??
    {
      label,
      trades: 0,
      wins: 0,
      losses: 0,
      totalDollars: 0,
      totalAbsDollars: 0,
      totalR: 0,
      grossWinDollars: 0,
      grossLossDollars: 0
    };
  bucket.trades += 1;
  bucket.totalDollars += trade.pnlDollars;
  bucket.totalAbsDollars += Math.abs(trade.pnlDollars);
  bucket.totalR += trade.rMultiple;
  if (trade.rMultiple > 0) {
    bucket.wins += 1;
    bucket.grossWinDollars += Math.max(0, trade.pnlDollars);
  } else if (trade.rMultiple < 0) {
    bucket.losses += 1;
    bucket.grossLossDollars += Math.abs(Math.min(0, trade.pnlDollars));
  }
  map.set(key, bucket);
}

function segmentSummaries(map: Map<string, SegmentBucket>): SegmentSummary[] {
  const totalAbs = sum([...map.values()].map((bucket) => bucket.totalAbsDollars));
  return [...map.values()].map((bucket) => ({
    label: bucket.label,
    trades: bucket.trades,
    wins: bucket.wins,
    losses: bucket.losses,
    winRatePct: bucket.trades ? (bucket.wins / bucket.trades) * 100 : 0,
    totalDollars: bucket.totalDollars,
    avgDollars: bucket.trades ? bucket.totalDollars / bucket.trades : 0,
    totalR: bucket.totalR,
    avgR: bucket.trades ? bucket.totalR / bucket.trades : 0,
    profitFactor: bucket.grossLossDollars ? bucket.grossWinDollars / bucket.grossLossDollars : bucket.grossWinDollars ? Infinity : 0,
    sharePct: totalAbs ? (bucket.totalAbsDollars / totalAbs) * 100 : 0
  }));
}

function segmentRollup(map: Map<string, SegmentBucket>): SegmentRollup {
  const summaries = segmentSummaries(map);
  const sortedByPnl = [...summaries].sort((left, right) => right.totalDollars - left.totalDollars);
  const sortedByShare = [...summaries].sort((left, right) => right.sharePct - left.sharePct);
  const hhi = summaries.reduce((total, summary) => total + (summary.sharePct / 100) ** 2, 0);
  const entropy = summaries.reduce((total, summary) => {
    const share = summary.sharePct / 100;
    return share > 0 ? total - share * Math.log(share) : total;
  }, 0);
  const positiveProfit = sum(summaries.filter((summary) => summary.totalDollars > 0).map((summary) => summary.totalDollars));
  const effectiveCount = hhi > 0 ? 1 / hhi : 0;
  return {
    count: summaries.length,
    best: sortedByPnl[0] ?? null,
    worst: sortedByPnl[sortedByPnl.length - 1] ?? null,
    largest: sortedByShare[0] ?? null,
    largestSharePct: sortedByShare[0]?.sharePct ?? 0,
    topThreeSharePct: sum(sortedByShare.slice(0, 3).map((summary) => summary.sharePct)),
    effectiveCount,
    entropyEffectiveCount: summaries.length ? Math.exp(entropy) : 0,
    profitablePct: summaries.length ? (summaries.filter((summary) => summary.totalDollars > 0).length / summaries.length) * 100 : 0,
    profitContributionPct: positiveProfit > 0 ? ((sortedByPnl[0]?.totalDollars ?? 0) / positiveProfit) * 100 : 0
  };
}

function commonSegment(map: Map<string, SegmentBucket>): SegmentSummary | null {
  return segmentSummaries(map).sort((left, right) => right.trades - left.trades || right.totalDollars - left.totalDollars)[0] ?? null;
}

function segmentMoney(summary: SegmentSummary | null, mode: "total" | "avg" = "total"): string {
  if (!summary) return "--";
  const dollars = mode === "avg" ? summary.avgDollars : summary.totalDollars;
  return `${shortLabel(summary.label)} ${fmtMoney(dollars, true)}`;
}

function segmentShare(summary: SegmentSummary | null): string {
  if (!summary) return "--";
  return `${shortLabel(summary.label)} ${fmtPct(summary.sharePct)}`;
}

function makeTradeSnapshots(
  trades: BasketTrade[],
  strategyByKey: Map<string, StrategyStatsOption>,
  scaleForTrade: (trade: BasketTrade) => number
): TradeSnapshot[] {
  return trades.map((trade) => {
    const strategy = strategyByKey.get(trade.key);
    const scale = scaleForTrade(trade);
    const durationMs = tradeDurationMs(trade);
    const entryMs = Date.parse(trade.entryTime);
    const exitMs = Date.parse(trade.exitTime);
    const strategyLabel = segmentKey(trade.label ?? strategy?.label, trade.key);
    const symbolLabel = segmentKey(trade.symbol ?? strategy?.symbol, "Unknown");
    const marketLabel = segmentKey(trade.market ?? strategy?.market, "Unknown");
    const phaseLabel = segmentKey(trade.phase ?? strategy?.phase, "Unknown");
    const sideLabel = trade.side === "long" ? "Long" : trade.side === "short" ? "Short" : "Unknown";

    return {
      ...trade,
      entryMs,
      exitMs,
      pnlDollars: trade.basePnlDollars * scale,
      riskDollars: Math.abs(trade.baseRiskDollars * scale),
      targetDollars: Math.abs(trade.baseTargetDollars * scale),
      durationMs,
      strategyLabel,
      symbolLabel,
      marketLabel,
      phaseLabel,
      sideLabel,
      exitBucket: exitBucketLabel(trade.exitReason)
    };
  });
}

function aggregateDollars(trades: TradeSnapshot[]): DollarAggregate {
  let grossWinR = 0;
  let grossLossR = 0;
  let grossWinDollars = 0;
  let grossLossDollars = 0;
  let totalDollars = 0;
  let winDollars = 0;
  let lossDollars = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  const dailyPnl = new Map<string, number>();
  const monthlyPnl = new Map<string, number>();
  const weeklyPnl = new Map<string, number>();
  const quarterlyPnl = new Map<string, number>();
  const tradesByEntryDay = new Map<string, number>();
  const durationsMs: number[] = [];
  const winDurationsMs: number[] = [];
  const lossDurationsMs: number[] = [];
  const barsHeld: number[] = [];
  const tradePnlDollars: number[] = [];
  const rMultiples: number[] = [];
  const winRMultiples: number[] = [];
  const lossRMultiples: number[] = [];
  const riskDollars: number[] = [];
  const targetDollars: number[] = [];
  const entryGapsMs: number[] = [];
  const afterWinDollars: number[] = [];
  const afterLossDollars: number[] = [];
  const strategySegments = new Map<string, SegmentBucket>();
  const symbolSegments = new Map<string, SegmentBucket>();
  const marketSegments = new Map<string, SegmentBucket>();
  const phaseSegments = new Map<string, SegmentBucket>();
  const sideSegments = new Map<string, SegmentBucket>();
  const weekdaySegments = new Map<string, SegmentBucket>();
  const entryHourSegments = new Map<string, SegmentBucket>();
  const monthSegments = new Map<string, SegmentBucket>();
  const exitReasonSegments = new Map<string, SegmentBucket>();

  const exitSortedTrades = [...trades].sort((left, right) => {
    const leftTime = Number.isFinite(left.exitMs) ? left.exitMs : left.entryMs;
    const rightTime = Number.isFinite(right.exitMs) ? right.exitMs : right.entryMs;
    return leftTime - rightTime;
  });

  const entrySortedTrades = [...trades].sort((left, right) => left.entryMs - right.entryMs);
  for (let index = 1; index < entrySortedTrades.length; index += 1) {
    const gap = (entrySortedTrades[index]?.entryMs ?? 0) - (entrySortedTrades[index - 1]?.entryMs ?? 0);
    if (Number.isFinite(gap) && gap > 0) entryGapsMs.push(gap);
  }

  for (let index = 0; index < exitSortedTrades.length; index += 1) {
    const trade = exitSortedTrades[index]!;
    const pnl = trade.pnlDollars;
    const result = trade.rMultiple;
    const durationMs = trade.durationMs;
    totalDollars += pnl;
    tradePnlDollars.push(pnl);
    rMultiples.push(result);
    riskDollars.push(trade.riskDollars);
    targetDollars.push(trade.targetDollars);
    if (durationMs > 0) durationsMs.push(durationMs);
    if (Number.isFinite(trade.barsHeld) && trade.barsHeld > 0) barsHeld.push(trade.barsHeld);
    const dayKey = localTradeDayKey(trade.exitTime);
    dailyPnl.set(dayKey, (dailyPnl.get(dayKey) ?? 0) + pnl);
    const monthKey = localTradeMonthKey(trade.exitTime);
    monthlyPnl.set(monthKey, (monthlyPnl.get(monthKey) ?? 0) + pnl);
    const weekKey = localTradeWeekKey(trade.exitTime);
    weeklyPnl.set(weekKey, (weeklyPnl.get(weekKey) ?? 0) + pnl);
    const quarterKey = localTradeQuarterKey(trade.exitTime);
    quarterlyPnl.set(quarterKey, (quarterlyPnl.get(quarterKey) ?? 0) + pnl);
    const entryDayKey = localTradeDayKey(trade.entryTime);
    tradesByEntryDay.set(entryDayKey, (tradesByEntryDay.get(entryDayKey) ?? 0) + 1);

    if (result > 0) {
      wins += 1;
      grossWinR += result;
      grossWinDollars += Math.max(0, pnl);
      winDollars += pnl;
      winRMultiples.push(result);
      if (durationMs > 0) winDurationsMs.push(durationMs);
    } else if (result < 0) {
      losses += 1;
      grossLossR += Math.abs(result);
      grossLossDollars += Math.abs(Math.min(0, pnl));
      lossDollars += pnl;
      lossRMultiples.push(result);
      if (durationMs > 0) lossDurationsMs.push(durationMs);
    } else {
      breakevens += 1;
    }

    const previousTrade = exitSortedTrades[index - 1];
    if (previousTrade?.rMultiple && previousTrade.rMultiple > 0) afterWinDollars.push(pnl);
    if (previousTrade?.rMultiple && previousTrade.rMultiple < 0) afterLossDollars.push(pnl);

    addSegment(strategySegments, trade.key, trade.strategyLabel, trade);
    addSegment(symbolSegments, trade.symbolLabel, trade.symbolLabel, trade);
    addSegment(marketSegments, trade.marketLabel, trade.marketLabel, trade);
    addSegment(phaseSegments, trade.phaseLabel, trade.phaseLabel, trade);
    addSegment(sideSegments, trade.sideLabel, trade.sideLabel, trade);
    addSegment(weekdaySegments, localWeekdayLabel(trade.entryTime), localWeekdayLabel(trade.entryTime), trade);
    addSegment(entryHourSegments, localHourLabel(trade.entryTime), localHourLabel(trade.entryTime), trade);
    addSegment(monthSegments, localMonthLabel(trade.entryTime), localMonthLabel(trade.entryTime), trade);
    addSegment(exitReasonSegments, trade.exitBucket, trade.exitBucket, trade);
  }

  const dailyCurve = dailyCurvePoints(dailyPnl);
  const dailyValues = dailyCurve.map((point) => point.pnl);
  const averageDailyPnl = mean(dailyValues);
  const activeDailyValues = [...dailyPnl.values()];
  const monthlyEntries = [...monthlyPnl.entries()];
  const monthlyValues = monthlyEntries.map(([, pnl]) => pnl);
  const averageMonthlyPnl = mean(monthlyValues);
  const bestMonthEntry = monthlyEntries.reduce<[string, number] | null>(
    (best, entry) => (!best || entry[1] > best[1] ? entry : best),
    null
  );
  const worstMonthEntry = monthlyEntries.reduce<[string, number] | null>(
    (worst, entry) => (!worst || entry[1] < worst[1] ? entry : worst),
    null
  );
  const monthlyGrossWinDollars = sum(monthlyValues.filter((value) => value > 0));
  const monthlyGrossLossDollars = Math.abs(sum(monthlyValues.filter((value) => value < 0)));
  const weeklyValues = [...weeklyPnl.values()];
  const quarterlyValues = [...quarterlyPnl.values()];
  const avgWinDollars = wins ? winDollars / wins : 0;
  const avgLossDollars = losses ? lossDollars / losses : 0;
  const avgWinR = mean(winRMultiples);
  const avgLossR = mean(lossRMultiples);
  const totalR = sum(rMultiples);
  const avgR = mean(rMultiples);
  const stdDevR = sampleStdDev(rMultiples, avgR);
  const avgTradeDollars = mean(tradePnlDollars);
  const tradeStdDevDollars = sampleStdDev(tradePnlDollars, avgTradeDollars);
  const expectancyStdErrorDollars = trades.length > 1 ? tradeStdDevDollars / Math.sqrt(trades.length) : 0;
  const dailyGrossWinDollars = sum(activeDailyValues.filter((value) => value > 0));
  const dailyGrossLossDollars = Math.abs(sum(activeDailyValues.filter((value) => value < 0)));
  const largestWinningDay = Math.max(0, ...dailyPnl.values());
  const consistencyRatio = totalDollars > 0 && largestWinningDay > 0 ? largestWinningDay / totalDollars : null;
  const tradeDrawdowns: number[] = [];
  let tradeEquity = 0;
  let tradePeak = 0;
  let minTradeEquity = 0;
  let maxTradeDrawdownDollars = 0;
  let maxRunupDollars = 0;
  let equityHighs = 0;
  for (const trade of exitSortedTrades) {
    tradeEquity += trade.pnlDollars;
    if (tradeEquity > tradePeak) {
      tradePeak = tradeEquity;
      equityHighs += 1;
    }
    minTradeEquity = Math.min(minTradeEquity, tradeEquity);
    maxRunupDollars = Math.max(maxRunupDollars, tradeEquity - minTradeEquity);
    const drawdown = Math.max(0, tradePeak - tradeEquity);
    tradeDrawdowns.push(drawdown);
    maxTradeDrawdownDollars = Math.max(maxTradeDrawdownDollars, drawdown);
  }

  const currentDrawdownDollars = tradeDrawdowns[tradeDrawdowns.length - 1] ?? 0;
  let longestUnderwaterDays = 0;
  let currentUnderwaterDays = 0;
  let underwaterRun = 0;
  for (const point of dailyCurve) {
    if (point.drawdown > 0) {
      underwaterRun += 1;
      longestUnderwaterDays = Math.max(longestUnderwaterDays, underwaterRun);
    } else {
      underwaterRun = 0;
    }
  }
  currentUnderwaterDays = underwaterRun;

  let currentStreakSign: "Win" | "Loss" | null = null;
  let currentStreakCount = 0;
  let currentStreakDollars = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let bestWinStreakDollars = 0;
  let worstLossStreakDollars = 0;
  let longestBreakevenStreak = 0;
  let breakevenStreak = 0;
  for (const trade of exitSortedTrades) {
    const sign = trade.rMultiple > 0 ? "Win" : trade.rMultiple < 0 ? "Loss" : null;
    if (!sign) {
      breakevenStreak += 1;
      longestBreakevenStreak = Math.max(longestBreakevenStreak, breakevenStreak);
      currentStreakSign = null;
      currentStreakCount = 0;
      currentStreakDollars = 0;
      continue;
    }
    breakevenStreak = 0;
    if (sign === currentStreakSign) {
      currentStreakCount += 1;
      currentStreakDollars += trade.pnlDollars;
    } else {
      currentStreakSign = sign;
      currentStreakCount = 1;
      currentStreakDollars = trade.pnlDollars;
    }
    if (sign === "Win") {
      longestWinStreak = Math.max(longestWinStreak, currentStreakCount);
      bestWinStreakDollars = Math.max(bestWinStreakDollars, currentStreakDollars);
    } else {
      longestLossStreak = Math.max(longestLossStreak, currentStreakCount);
      worstLossStreakDollars = Math.min(worstLossStreakDollars, currentStreakDollars);
    }
  }

  let currentTailSign: "Win" | "Loss" | null = null;
  let currentTailCount = 0;
  for (let index = exitSortedTrades.length - 1; index >= 0; index -= 1) {
    const sign = exitSortedTrades[index]!.rMultiple > 0 ? "Win" : exitSortedTrades[index]!.rMultiple < 0 ? "Loss" : null;
    if (!sign) break;
    if (!currentTailSign) currentTailSign = sign;
    if (sign !== currentTailSign) break;
    currentTailCount += 1;
  }

  const entryTimes = entrySortedTrades.map((trade) => trade.entryMs).filter(Number.isFinite);
  const exitTimes = exitSortedTrades
    .map((trade) => (Number.isFinite(trade.exitMs) ? trade.exitMs : trade.entryMs))
    .filter(Number.isFinite);
  const start = entryTimes.length ? Math.min(...entryTimes) : undefined;
  const end = exitTimes.length ? Math.max(...exitTimes) : start;
  const calendarDays = dailyCurve.length;
  const activeDays = dailyPnl.size;
  const calendarMs = start !== undefined && end !== undefined && end > start ? end - start : 0;
  const totalDurationMs = sum(durationsMs);
  const rewardRiskRatio = avgLossDollars < 0 ? avgWinDollars / Math.abs(avgLossDollars) : avgWinDollars > 0 ? Infinity : 0;
  const rRewardRiskRatio = avgLossR < 0 ? avgWinR / Math.abs(avgLossR) : avgWinR > 0 ? Infinity : 0;
  const breakEvenWinRatePct = rewardRiskRatio > 0 ? 100 / (1 + rewardRiskRatio) : 0;
  const winRatePct = trades.length ? (wins / trades.length) * 100 : 0;
  const lossRatePct = trades.length ? (losses / trades.length) * 100 : 0;
  const targetExitCount = segmentSummaries(exitReasonSegments).find((summary) => summary.label === "Target")?.trades ?? 0;
  const stopExitCount = segmentSummaries(exitReasonSegments).find((summary) => summary.label === "Stop")?.trades ?? 0;
  const otherExitCount = Math.max(0, trades.length - targetExitCount - stopExitCount);
  const winAfterWin = exitSortedTrades.slice(1).filter((trade, index) => exitSortedTrades[index]?.rMultiple > 0 && trade.rMultiple > 0).length;
  const afterWinCount = exitSortedTrades.slice(0, -1).filter((trade) => trade.rMultiple > 0).length;
  const winAfterLoss = exitSortedTrades.slice(1).filter((trade, index) => exitSortedTrades[index]?.rMultiple < 0 && trade.rMultiple > 0).length;
  const afterLossCount = exitSortedTrades.slice(0, -1).filter((trade) => trade.rMultiple < 0).length;
  const runs = sequenceRuns(rMultiples);
  const concurrencyEvents = entrySortedTrades
    .flatMap((trade) => [
      { time: trade.entryMs, delta: 1 },
      { time: Number.isFinite(trade.exitMs) ? trade.exitMs : trade.entryMs + trade.durationMs, delta: -1 }
    ])
    .filter((event) => Number.isFinite(event.time))
    .sort((left, right) => left.time - right.time || left.delta - right.delta);
  let concurrentTrades = 0;
  let maxConcurrentTrades = 0;
  let overlappingTrades = 0;
  for (const event of concurrencyEvents) {
    if (event.delta > 0) {
      if (concurrentTrades > 0) overlappingTrades += 1;
      concurrentTrades += 1;
      maxConcurrentTrades = Math.max(maxConcurrentTrades, concurrentTrades);
    } else {
      concurrentTrades = Math.max(0, concurrentTrades - 1);
    }
  }

  return {
    activeDayRatePct: calendarDays ? (activeDays / calendarDays) * 100 : 0,
    avgLossDollars,
    medianLossDollars: median(tradePnlDollars.filter((value) => value < 0)),
    avgWinDollars,
    medianWinDollars: median(tradePnlDollars.filter((value) => value > 0)),
    avgLossR,
    avgWinR,
    avgRiskDollars: mean(riskDollars),
    medianRiskDollars: median(riskDollars),
    avgTargetDollars: mean(targetDollars),
    medianTargetDollars: median(targetDollars),
    consistencyScorePct: consistencyRatio == null ? null : clampPct((1 - consistencyRatio) * 100),
    trades: trades.length,
    wins,
    losses,
    breakevens,
    winRatePct,
    lossRatePct,
    breakEvenWinRatePct,
    edgeOverBreakEvenPct: winRatePct - breakEvenWinRatePct,
    kellyPct: rewardRiskRatio > 0 ? (winRatePct / 100 - (1 - winRatePct / 100) / rewardRiskRatio) * 100 : 0,
    profitFactor: grossLossDollars ? grossWinDollars / grossLossDollars : grossWinDollars ? Infinity : 0,
    rProfitFactor: grossLossR ? grossWinR / grossLossR : grossWinR ? Infinity : 0,
    rewardRiskRatio,
    rRewardRiskRatio,
    sharpeRatio: annualizedRatio(averageDailyPnl, sampleStdDev(dailyValues, averageDailyPnl), 252),
    sortinoRatio: annualizedRatio(averageDailyPnl, downsideDeviation(dailyValues), 252),
    sqn: stdDevR > 0 ? (Math.sqrt(rMultiples.length) * avgR) / stdDevR : avgR > 0 ? Infinity : 0,
    totalR,
    avgR,
    medianR: median(rMultiples),
    stdDevR,
    downsideDeviationR: downsideDeviation(rMultiples),
    medianAbsoluteDeviationR: medianAbsoluteDeviation(rMultiples),
    bestR: Math.max(0, ...rMultiples),
    worstR: Math.min(0, ...rMultiples),
    p05R: percentile(rMultiples, 5),
    p10R: percentile(rMultiples, 10),
    p25R: percentile(rMultiples, 25),
    p75R: percentile(rMultiples, 75),
    p90R: percentile(rMultiples, 90),
    p95R: percentile(rMultiples, 95),
    cvarLossR: tailAverage(rMultiples, 5, "bottom"),
    iqrR: percentile(rMultiples, 75) - percentile(rMultiples, 25),
    skewR: skewness(rMultiples),
    excessKurtosisR: excessKurtosis(rMultiples),
    avgDurationMs: mean(durationsMs),
    avgWinDurationMs: mean(winDurationsMs),
    avgLossDurationMs: mean(lossDurationsMs),
    medianDurationMs: median(durationsMs),
    durationIqrMs: percentile(durationsMs, 75) - percentile(durationsMs, 25),
    durationStdDevMs: sampleStdDev(durationsMs, mean(durationsMs)),
    medianWinDurationMs: median(winDurationsMs),
    medianLossDurationMs: median(lossDurationsMs),
    shortestDurationMs: durationsMs.length ? Math.min(...durationsMs) : 0,
    avgBarsHeld: mean(barsHeld),
    maxBarsHeld: Math.max(0, ...barsHeld),
    longestDurationMs: Math.max(0, ...durationsMs),
    totalDurationMs,
    exposurePct: calendarMs > 0 ? Math.min(999, (totalDurationMs / calendarMs) * 100) : 0,
    avgGapMs: mean(entryGapsMs),
    medianGapMs: median(entryGapsMs),
    gapIqrMs: percentile(entryGapsMs, 75) - percentile(entryGapsMs, 25),
    gapStdDevMs: sampleStdDev(entryGapsMs, mean(entryGapsMs)),
    shortestGapMs: entryGapsMs.length ? Math.min(...entryGapsMs) : 0,
    longestGapMs: Math.max(0, ...entryGapsMs),
    maxConcurrentTrades,
    overlapRatePct: trades.length ? (overlappingTrades / trades.length) * 100 : 0,
    maxTradesPerActiveDay: Math.max(0, ...tradesByEntryDay.values()),
    tradesPerActiveDay: tradesByEntryDay.size ? trades.length / tradesByEntryDay.size : 0,
    maxDailyDrawdownDollars: Math.max(0, ...dailyCurve.map((point) => point.drawdown)),
    maxTradeDrawdownDollars,
    maxRunupDollars,
    recoveryFactor: maxTradeDrawdownDollars > 0 ? totalDollars / maxTradeDrawdownDollars : totalDollars > 0 ? Infinity : 0,
    ulcerIndexDollars: Math.sqrt(mean(dailyCurve.map((point) => point.drawdown ** 2))),
    painIndexDollars: mean(dailyCurve.map((point) => point.drawdown)),
    underwaterDaysPct: dailyCurve.length ? (dailyCurve.filter((point) => point.drawdown > 0).length / dailyCurve.length) * 100 : 0,
    equityHighs,
    currentDrawdownDollars,
    currentUnderwaterDays,
    longestUnderwaterDays,
    tradeStdDevDollars,
    tradeDownsideDeviationDollars: downsideDeviation(tradePnlDollars),
    tradeMedianAbsoluteDeviationDollars: medianAbsoluteDeviation(tradePnlDollars),
    tradeIqrDollars: percentile(tradePnlDollars, 75) - percentile(tradePnlDollars, 25),
    expectancyStdErrorDollars,
    expectancyTStat: expectancyStdErrorDollars > 0 ? avgTradeDollars / expectancyStdErrorDollars : avgTradeDollars > 0 ? Infinity : 0,
    expectancyLower95Dollars: avgTradeDollars - 1.96 * expectancyStdErrorDollars,
    avgDailyDollars: averageDailyPnl,
    avgActiveDayDollars: mean(activeDailyValues),
    avgMonthlyDollars: averageMonthlyPnl,
    medianMonthlyDollars: median(monthlyValues),
    stdDevMonthlyDollars: sampleStdDev(monthlyValues, averageMonthlyPnl),
    bestMonthDollars: bestMonthEntry?.[1] ?? 0,
    worstMonthDollars: worstMonthEntry?.[1] ?? 0,
    bestMonthPeriod: bestMonthEntry ? formatTradeMonthKey(bestMonthEntry[0]) : "--",
    worstMonthPeriod: worstMonthEntry ? formatTradeMonthKey(worstMonthEntry[0]) : "--",
    activeMonths: monthlyValues.length,
    winningMonths: monthlyValues.filter((value) => value > 0).length,
    losingMonths: monthlyValues.filter((value) => value < 0).length,
    winningMonthRatePct: monthlyValues.length ? (monthlyValues.filter((value) => value > 0).length / monthlyValues.length) * 100 : 0,
    monthlyProfitFactor: monthlyGrossLossDollars
      ? monthlyGrossWinDollars / monthlyGrossLossDollars
      : monthlyGrossWinDollars
        ? Infinity
        : 0,
    dailyProfitFactor: dailyGrossLossDollars ? dailyGrossWinDollars / dailyGrossLossDollars : dailyGrossWinDollars ? Infinity : 0,
    medianDailyDollars: median(activeDailyValues),
    stdDevDailyDollars: sampleStdDev(activeDailyValues, mean(activeDailyValues)),
    activeWeeks: weeklyValues.length,
    avgWeeklyDollars: mean(weeklyValues),
    winningWeekRatePct: weeklyValues.length ? (weeklyValues.filter((value) => value > 0).length / weeklyValues.length) * 100 : 0,
    bestWeekDollars: Math.max(0, ...weeklyValues),
    worstWeekDollars: Math.min(0, ...weeklyValues),
    activeQuarters: quarterlyValues.length,
    avgQuarterlyDollars: mean(quarterlyValues),
    winningQuarterRatePct: quarterlyValues.length
      ? (quarterlyValues.filter((value) => value > 0).length / quarterlyValues.length) * 100
      : 0,
    bestTradeDollars: tradePnlDollars.length ? Math.max(...tradePnlDollars) : 0,
    bestDayDollars: Math.max(0, ...activeDailyValues),
    bestThreeTradesDollars: rollingExtreme(tradePnlDollars, 3, "best"),
    bestFiveTradesDollars: rollingExtreme(tradePnlDollars, 5, "best"),
    bestThreeDaysDollars: rollingExtreme(dailyValues, 3, "best"),
    bestFiveDaysDollars: rollingExtreme(dailyValues, 5, "best"),
    worstTradeDollars: tradePnlDollars.length ? Math.min(...tradePnlDollars) : 0,
    worstDayDollars: Math.min(0, ...activeDailyValues),
    worstThreeTradesDollars: rollingExtreme(tradePnlDollars, 3, "worst"),
    worstFiveTradesDollars: rollingExtreme(tradePnlDollars, 5, "worst"),
    worstThreeDaysDollars: rollingExtreme(dailyValues, 3, "worst"),
    worstFiveDaysDollars: rollingExtreme(dailyValues, 5, "worst"),
    grossWinDollars,
    grossLossDollars,
    p05TradeDollars: percentile(tradePnlDollars, 5),
    p10TradeDollars: percentile(tradePnlDollars, 10),
    p25TradeDollars: percentile(tradePnlDollars, 25),
    p50TradeDollars: percentile(tradePnlDollars, 50),
    p75TradeDollars: percentile(tradePnlDollars, 75),
    p90TradeDollars: percentile(tradePnlDollars, 90),
    p95TradeDollars: percentile(tradePnlDollars, 95),
    cvarLossDollars: tailAverage(tradePnlDollars, 5, "bottom"),
    cvarWinDollars: tailAverage(tradePnlDollars, 5, "top"),
    tailRatio: Math.abs(percentile(tradePnlDollars, 5)) > 0 ? percentile(tradePnlDollars, 95) / Math.abs(percentile(tradePnlDollars, 5)) : 0,
    activeDays,
    calendarDays,
    winningDays: activeDailyValues.filter((value) => value > 0).length,
    losingDays: activeDailyValues.filter((value) => value < 0).length,
    winningDayRatePct: activeDailyValues.length ? (activeDailyValues.filter((value) => value > 0).length / activeDailyValues.length) * 100 : 0,
    dailyCurve,
    totalDollars,
    avgDollars: avgTradeDollars,
    longestWinStreak,
    longestLossStreak,
    bestWinStreakDollars,
    worstLossStreakDollars,
    currentStreakLabel: currentTailSign ?? "None",
    currentStreakCount: currentTailCount,
    avgAfterWinDollars: mean(afterWinDollars),
    avgAfterLossDollars: mean(afterLossDollars),
    winAfterWinPct: afterWinCount ? (winAfterWin / afterWinCount) * 100 : 0,
    winAfterLossPct: afterLossCount ? (winAfterLoss / afterLossCount) * 100 : 0,
    lagOneCorrelation: lagOneCorrelation(rMultiples),
    runsCount: runs.count,
    runsZScore: runs.zScore,
    longestBreakevenStreak,
    avgWinToTargetPct: mean(
      exitSortedTrades.filter((trade) => trade.rMultiple > 0 && trade.targetDollars > 0).map((trade) => (trade.pnlDollars / trade.targetDollars) * 100)
    ),
    avgLossToRiskPct: mean(
      exitSortedTrades.filter((trade) => trade.rMultiple < 0 && trade.riskDollars > 0).map((trade) => (Math.abs(trade.pnlDollars) / trade.riskDollars) * 100)
    ),
    riskIqrDollars: percentile(riskDollars, 75) - percentile(riskDollars, 25),
    targetIqrDollars: percentile(targetDollars, 75) - percentile(targetDollars, 25),
    riskCoefficientVariationPct: mean(riskDollars) > 0 ? (sampleStdDev(riskDollars, mean(riskDollars)) / mean(riskDollars)) * 100 : 0,
    targetCoefficientVariationPct:
      mean(targetDollars) > 0 ? (sampleStdDev(targetDollars, mean(targetDollars)) / mean(targetDollars)) * 100 : 0,
    targetExitCount,
    stopExitCount,
    otherExitCount,
    targetExitRatePct: trades.length ? (targetExitCount / trades.length) * 100 : 0,
    stopExitRatePct: trades.length ? (stopExitCount / trades.length) * 100 : 0,
    tradesPerDay: calendarMs > 0 ? trades.length / (calendarMs / 86_400_000) : 0,
    tradesPerWeek: calendarMs > 0 ? trades.length / (calendarMs / (7 * 86_400_000)) : 0,
    tradesPerMonth: calendarMs > 0 ? trades.length / (calendarMs / (30.4375 * 86_400_000)) : 0,
    tradesPerYear: calendarMs > 0 ? trades.length / (calendarMs / (365.25 * 86_400_000)) : 0,
    start,
    end,
    strategies: segmentRollup(strategySegments),
    symbols: segmentRollup(symbolSegments),
    markets: segmentRollup(marketSegments),
    phases: segmentRollup(phaseSegments),
    sides: segmentRollup(sideSegments),
    weekdays: segmentRollup(weekdaySegments),
    entryHours: segmentRollup(entryHourSegments),
    months: segmentRollup(monthSegments),
    exitReasons: segmentRollup(exitReasonSegments),
    commonExitReason: commonSegment(exitReasonSegments)
  };
}

function outcomeForChartTrade(trade: TradeSnapshot): string {
  if (trade.rMultiple > 0) return "Win";
  if (trade.rMultiple < 0) return "Loss";
  return "Breakeven";
}

function chartSample<T>(values: T[], limit = 48): T[] {
  if (values.length <= limit) return values;
  const sampled: T[] = [];
  for (let index = 0; index < limit; index += 1) {
    sampled.push(values[Math.round((index / (limit - 1)) * (values.length - 1))]!);
  }
  return sampled;
}

function categoryChartData(
  trades: TradeSnapshot[],
  keyForTrade: (trade: TradeSnapshot) => string,
  valueForTrade: (trade: TradeSnapshot) => number,
  limit = 8
): ChartDatum[] {
  const buckets = new Map<string, { total: number; count: number }>();
  for (const trade of trades) {
    const key = keyForTrade(trade);
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };
    bucket.total += valueForTrade(trade);
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([label, bucket]) => ({ label, value: bucket.total, secondary: bucket.count }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, limit);
}

function histogramData(values: number[], bins = 10): ChartDatum[] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [];
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  if (minimum === maximum) return [{ label: fmtNumber(minimum), value: finite.length }];
  const width = (maximum - minimum) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (const value of finite) {
    counts[Math.min(bins - 1, Math.floor((value - minimum) / width))] += 1;
  }
  return counts.map((count, index) => ({
    label: fmtNumber(minimum + width * (index + 0.5)),
    value: count
  }));
}

function rollingChartData(values: ChartDatum[], windowSize: number): ChartDatum[] {
  return values.map((point, index) => {
    const window = values.slice(Math.max(0, index - windowSize + 1), index + 1);
    return {
      ...point,
      value: mean(window.map((entry) => entry.value)),
      detail: `${window.length}-trade rolling sample`
    };
  });
}

function averageCategoryData(data: ChartDatum[]): ChartDatum[] {
  return data.map((point) => ({
    ...point,
    value: point.secondary ? point.value / point.secondary : 0,
    detail: `${fmtCount(point.secondary ?? 0)} trades in this group`
  }));
}

function ChartFrame({ chart }: { chart: StatsChartData }) {
  return (
    <article className="selectedStatsChart">
      <header><strong>{chart.title}</strong><span>{chart.subtitle}</span></header>
      {chart.chart}
    </article>
  );
}

function ChartTooltip({ context, detail, label, value }: { context: string; detail?: string; label: string; value: string }) {
  return (
    <div className="statsChartTooltip" role="status">
      <span>{context}</span><strong>{value}</strong><small>{label}</small>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

type ChartTooltipProps = {
  tooltipContext?: string;
  tooltipDetail?: (point: ChartDatum) => string;
};

function LineChart({
  data,
  formatValue = fmtMoney,
  secondaryLabel,
  tooltipContext = "Value",
  tooltipDetail
}: {
  data: ChartDatum[];
  formatValue?: (value: number) => string;
  secondaryLabel?: string;
} & ChartTooltipProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 640;
  const height = 190;
  const padX = 16;
  const padY = 18;
  const allValues = data.flatMap((point) => (point.secondary == null ? [point.value] : [point.value, point.secondary]));
  const minimum = Math.min(0, ...allValues);
  const maximum = Math.max(0, ...allValues);
  const range = Math.max(1, maximum - minimum);
  const x = (index: number) => padX + (index / Math.max(1, data.length - 1)) * (width - padX * 2);
  const y = (value: number) => padY + ((maximum - value) / range) * (height - padY * 2);
  const points = data.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
  const secondaryPoints = data.filter((point) => point.secondary != null).map((point, index) => `${x(index)},${y(point.secondary ?? 0)}`).join(" ");
  const activePoint = activeIndex == null ? null : data[activeIndex] ?? null;
  return (
    <div className="selectedStatsChartPlot statsChartInteractive" onMouseLeave={() => setActiveIndex(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${tooltipContext} line chart`}>
        <line className="statsChartGridLine" x1={padX} x2={width - padX} y1={y(0)} y2={y(0)} />
        <polyline className="statsChartLine" points={points} />
        {secondaryPoints ? <polyline className="statsChartLine secondary" points={secondaryPoints} /> : null}
        {data.map((point, index) => (
          <circle
            key={`${point.label}-${index}`}
            className={`statsChartPoint${point.value < 0 ? " negative" : ""}${activeIndex === index ? " isActive" : ""}`}
            cx={x(index)} cy={y(point.value)} r="3" tabIndex={0}
            onClick={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onMouseEnter={() => setActiveIndex(index)}
          />
        ))}
      </svg>
      {activePoint ? (
        <ChartTooltip
          context={tooltipContext}
          detail={tooltipDetail?.(activePoint) ?? activePoint.detail}
          label={activePoint.label}
          value={`${formatValue(activePoint.value)}${activePoint.secondary == null ? "" : ` · ${secondaryLabel ?? "Second"} ${formatValue(activePoint.secondary)}`}`}
        />
      ) : null}
      <div className="selectedStatsChartAxis"><span>{data[0]?.label ?? "--"}</span><span>{data[data.length - 1]?.label ?? "--"}</span></div>
    </div>
  );
}

function BarChart({
  data,
  formatValue = fmtMoney,
  horizontal = false,
  tooltipContext = "Value",
  tooltipDetail
}: {
  data: ChartDatum[];
  formatValue?: (value: number) => string;
  horizontal?: boolean;
} & ChartTooltipProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const maximum = Math.max(1, ...data.map((point) => Math.abs(point.value)));
  const activePoint = activeIndex == null ? null : data[activeIndex] ?? null;
  const tooltip = activePoint ? <ChartTooltip context={tooltipContext} detail={tooltipDetail?.(activePoint) ?? activePoint.detail} label={activePoint.label} value={formatValue(activePoint.value)} /> : null;
  if (horizontal) {
    return (
      <div className="selectedStatsHorizontalBars statsChartInteractive" onMouseLeave={() => setActiveIndex(null)}>
        {data.map((point, index) => (
          <div key={point.label} tabIndex={0} onClick={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onMouseEnter={() => setActiveIndex(index)}>
            <span>{shortLabel(point.label, 16)}</span><i><b className={point.value < 0 ? "negative" : ""} style={{ width: `${(Math.abs(point.value) / maximum) * 100}%` }} /></i><strong>{formatValue(point.value)}</strong>
          </div>
        ))}
        {tooltip}
      </div>
    );
  }
  return (
    <div className="selectedStatsBars statsChartInteractive" role="img" aria-label={`${tooltipContext} bar chart`} onMouseLeave={() => setActiveIndex(null)}>
      {data.map((point, index) => (
        <div key={point.label} className={`${point.value < 0 ? "negative" : ""}${activeIndex === index ? " isActive" : ""}`} tabIndex={0} onClick={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onMouseEnter={() => setActiveIndex(index)}>
          <i style={{ height: `${Math.max(4, (Math.abs(point.value) / maximum) * 100)}%` }} /><span>{shortLabel(point.label, 7)}</span>
        </div>
      ))}
      {tooltip}
    </div>
  );
}

function ScatterChart({
  data,
  formatX = fmtMoney,
  formatY = fmtMoney,
  tooltipContext = "Trade",
  xLabel = "X",
  yLabel = "Y"
}: {
  data: ChartDatum[];
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  tooltipContext?: string;
  xLabel?: string;
  yLabel?: string;
}) {
  const [activePoint, setActivePoint] = useState<ChartDatum | null>(null);
  const width = 640;
  const height = 190;
  const sampled = chartSample(data, 80);
  const minX = Math.min(0, ...sampled.map((point) => point.value));
  const maxX = Math.max(1, ...sampled.map((point) => point.value));
  const minY = Math.min(0, ...sampled.map((point) => point.secondary ?? 0));
  const maxY = Math.max(1, ...sampled.map((point) => point.secondary ?? 0));
  const x = (value: number) => 16 + ((value - minX) / Math.max(1, maxX - minX)) * 608;
  const y = (value: number) => 174 - ((value - minY) / Math.max(1, maxY - minY)) * 158;
  return (
    <div className="selectedStatsChartPlot statsChartInteractive" onMouseLeave={() => setActivePoint(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${tooltipContext} scatter plot`}>
        <line className="statsChartGridLine" x1="16" x2="624" y1={y(0)} y2={y(0)} />
        <line className="statsChartGridLine" x1={x(0)} x2={x(0)} y1="16" y2="174" />
        {sampled.map((point, index) => (
          <circle key={`${point.label}-${index}`} className="statsChartScatterPoint" cx={x(point.value)} cy={y(point.secondary ?? 0)} r="4" tabIndex={0}
            onClick={() => setActivePoint(point)} onFocus={() => setActivePoint(point)} onMouseEnter={() => setActivePoint(point)} />
        ))}
      </svg>
      {activePoint ? <ChartTooltip context={tooltipContext} detail={activePoint.detail} label={activePoint.label} value={`${xLabel} ${formatX(activePoint.value)} · ${yLabel} ${formatY(activePoint.secondary ?? 0)}`} /> : null}
      <div className="selectedStatsChartAxis"><span>{xLabel}: low</span><span>{xLabel}: high</span></div>
    </div>
  );
}

function OutcomeStrip({ data, tooltipContext = "Trade outcome" }: { data: ChartDatum[]; tooltipContext?: string }) {
  const [activePoint, setActivePoint] = useState<ChartDatum | null>(null);
  return (
    <div className="selectedStatsOutcomeStrip statsChartInteractive" role="img" aria-label={tooltipContext} onMouseLeave={() => setActivePoint(null)}>
      {chartSample(data, 100).map((point, index) => (
        <i key={`${point.label}-${index}`} className={point.value > 0 ? "win" : point.value < 0 ? "loss" : "flat"} tabIndex={0}
          onClick={() => setActivePoint(point)} onFocus={() => setActivePoint(point)} onMouseEnter={() => setActivePoint(point)} />
      ))}
      {activePoint ? <ChartTooltip context={tooltipContext} detail={activePoint.detail} label={activePoint.label} value={fmtR(activePoint.value, true)} /> : null}
    </div>
  );
}

function DonutChart({ data, tooltipContext = "Share" }: { data: ChartDatum[]; tooltipContext?: string }) {
  const [activePoint, setActivePoint] = useState<ChartDatum | null>(null);
  const total = sum(data.map((point) => Math.max(0, point.value)));
  let cursor = 0;
  const colors = ["var(--up)", "var(--down)", "var(--stats-chart-accent)", "#a78bfa", "#f59e0b", "#22d3ee"];
  const gradient = data.map((point, index) => {
    const start = cursor;
    cursor += total ? (Math.max(0, point.value) / total) * 100 : 0;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  }).join(", ");
  return (
    <div className="selectedStatsDonut statsChartInteractive" onMouseLeave={() => setActivePoint(null)}>
      <i style={{ background: `conic-gradient(${gradient || "var(--stats-chart-grid) 0 100%"})` }} />
      <div>
        {data.map((point, index) => (
          <span key={point.label} tabIndex={0} onClick={() => setActivePoint(point)} onFocus={() => setActivePoint(point)} onMouseEnter={() => setActivePoint(point)}>
            <b style={{ background: colors[index % colors.length] }} />{point.label}<strong>{fmtCount(point.value)}</strong>
          </span>
        ))}
      </div>
      {activePoint ? <ChartTooltip context={tooltipContext} detail={activePoint.detail} label={activePoint.label} value={`${fmtCount(activePoint.value)} · ${fmtPct(total ? (activePoint.value / total) * 100 : 0)}`} /> : null}
    </div>
  );
}

function StatsChartRail({ charts, title }: { charts: StatsChartData[]; title: string }) {
  return (
    <details
      className="selectedStatsCharts"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <summary>
        <span>Charts</span>
        <small>{charts.length} views</small>
        <i aria-hidden />
      </summary>
      <div className="selectedStatsChartGrid" aria-label={`${title} charts`}>
        {charts.map((chart) => <ChartFrame key={chart.title} chart={chart} />)}
      </div>
    </details>
  );
}

function StatCard({ stat }: { stat: StatCardData }) {
  return (
    <div
      className={`backtest-stat-card ${stat.tone ?? "tone-neutral"}${stat.text ? " text-stat-card" : ""}${stat.className ? ` ${stat.className}` : ""}`}
      title={stat.title}
    >
      <span>{stat.label}</span>
      <strong>{stat.value}</strong>
    </div>
  );
}

function StatGroup({ charts, stats, title }: { charts: StatsChartData[]; stats: StatCardData[]; title: string }) {
  return (
    <section className="selectedStatsGroup" aria-label={title}>
      <h3>{title}</h3>
      <div className="backtest-stats-grid selectedStatsDenseGrid">
        {stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>
      <StatsChartRail charts={charts} title={title} />
    </section>
  );
}

function showWhenTrades(aggregate: DollarAggregate, value: ReactNode): ReactNode {
  return aggregate.trades ? value : "--";
}

function moneyStat(label: string, value: number, trades: number, signed = true, higherIsGood = true): StatCardData {
  return {
    label,
    value: trades ? fmtMoney(value, signed) : "--",
    tone: trades ? (statTone(value, higherIsGood) as StatTone) : "tone-neutral"
  };
}

function ratioStat(label: string, value: number, threshold: number, trades: number): StatCardData {
  return {
    label,
    value: trades ? fmtNumber(value) : "--",
    tone: trades ? (ratioTone(value, threshold) as StatTone) : "tone-neutral"
  };
}

export default function SelectedStrategyStats({
  customScaleRange,
  dataEndAt,
  defaultExpanded = false,
  strategies,
  toggleable = true,
  trades,
  persistedStrategyEdits
}: SelectedStrategyStatsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const edits = useStrategyEdits(strategies, persistedStrategyEdits);
  const strategyByKey = new Map(strategies.map((strategy) => [strategy.key, strategy]));
  const parsedCustomScaleRange = parseCustomScaleRange(customScaleRange);
  const selectedTradeSnapshots = makeTradeSnapshots(trades, strategyByKey, (trade) => {
    if (trade.lockedSize) return 1;
    const strategy = strategyByKey.get(trade.key);
    return parsedCustomScaleRange
      ? customRangeScaleForTrade(trade, parsedCustomScaleRange)
      : strategy
        ? strategyContractScale(strategy, edits)
        : 1;
  });
  const selectedDollarAggregate = aggregateDollars(selectedTradeSnapshots);
  const stats = selectedDollarAggregate;
  const toggleExpanded = () => {
    if (toggleable) setExpanded((current) => !current);
  };
  const segmentTextStat = (
    label: string,
    summary: SegmentSummary | null,
    mode: "total" | "avg" | "share",
    tone: StatTone = "tone-neutral"
  ): StatCardData => {
    const value = mode === "share" ? segmentShare(summary) : segmentMoney(summary, mode);
    return {
      label,
      value: showWhenTrades(stats, value),
      tone,
      text: true,
      title: summary ? `${summary.label} | ${fmtMoney(summary.totalDollars, true)} | ${fmtNumber(summary.trades)} trades` : undefined
    };
  };

  const summaryStats: StatCardData[] = [
    ratioStat("Dollar PF", stats.profitFactor, 1, stats.trades),
    { label: "Win rate", value: showWhenTrades(stats, fmtPct(stats.winRatePct)), tone: stats.winRatePct >= 50 ? "tone-up" : "tone-neutral" },
    moneyStat("Total P&L", stats.totalDollars, stats.trades),
    moneyStat("Avg trade", stats.avgDollars, stats.trades),
    { label: "Max trade DD", value: showWhenTrades(stats, fmtMoney(-stats.maxTradeDrawdownDollars)), tone: stats.maxTradeDrawdownDollars > 0 ? "tone-down" : "tone-neutral" },
    ratioStat("Recovery", stats.recoveryFactor, 1, stats.trades),
    { label: "Trades", value: fmtCount(stats.trades), tone: "tone-neutral" },
    { label: "Expectancy", value: showWhenTrades(stats, fmtR(stats.avgR, true)), tone: statTone(stats.avgR) as StatTone },
    ratioStat("Daily Sharpe", stats.sharpeRatio, 1, stats.trades),
    { label: "Loss streak", value: showWhenTrades(stats, fmtCount(stats.longestLossStreak)), tone: stats.longestLossStreak >= 3 ? "tone-down" : "tone-neutral" },
    { label: "Models", value: showWhenTrades(stats, fmtCount(stats.strategies.count)), tone: "tone-neutral" },
    { label: "Active days", value: showWhenTrades(stats, fmtCount(stats.activeDays)), tone: "tone-neutral" }
  ];

  const performanceStats: StatCardData[] = [
    ratioStat("Dollar PF", stats.profitFactor, 1, stats.trades),
    ratioStat("R PF", stats.rProfitFactor, 1, stats.trades),
    moneyStat("Total P&L", stats.totalDollars, stats.trades),
    moneyStat("Gross profit", stats.grossWinDollars, stats.trades),
    moneyStat("Gross loss", -stats.grossLossDollars, stats.trades),
    moneyStat("Avg trade", stats.avgDollars, stats.trades),
    moneyStat("Median trade", stats.p50TradeDollars, stats.trades),
    { label: "Trade volatility", value: showWhenTrades(stats, fmtMoney(stats.tradeStdDevDollars)), tone: "tone-neutral", title: "Sample standard deviation of trade P&L" },
    { label: "Expectancy error", value: showWhenTrades(stats, fmtMoney(stats.expectancyStdErrorDollars)), tone: "tone-neutral", title: "Standard error of average trade expectancy" },
    ratioStat("Expectancy t-stat", stats.expectancyTStat, 1.96, stats.trades),
    moneyStat("95% expectancy floor", stats.expectancyLower95Dollars, stats.trades),
    { label: "Total R", value: showWhenTrades(stats, fmtR(stats.totalR, true)), tone: statTone(stats.totalR) as StatTone },
    { label: "Avg R", value: showWhenTrades(stats, fmtR(stats.avgR, true)), tone: statTone(stats.avgR) as StatTone },
    { label: "Median R", value: showWhenTrades(stats, fmtR(stats.medianR, true)), tone: statTone(stats.medianR) as StatTone },
    ratioStat("Daily Sharpe", stats.sharpeRatio, 1, stats.trades),
    ratioStat("Daily Sortino", stats.sortinoRatio, 1, stats.trades),
    ratioStat("SQN", stats.sqn, 1.6, stats.trades),
    { label: "Kelly", value: showWhenTrades(stats, fmtSignedPct(stats.kellyPct)), tone: statTone(stats.kellyPct) as StatTone },
    {
      label: "Consistency",
      value: stats.consistencyScorePct == null ? "--" : fmtPct(stats.consistencyScorePct),
      tone: consistencyTone(stats.consistencyScorePct) as StatTone
    },
    { label: "Edge over BE", value: showWhenTrades(stats, fmtSignedPct(stats.edgeOverBreakEvenPct)), tone: statTone(stats.edgeOverBreakEvenPct) as StatTone }
  ];

  const riskStats: StatCardData[] = [
    { label: "Max trade DD", value: showWhenTrades(stats, fmtMoney(-stats.maxTradeDrawdownDollars)), tone: stats.maxTradeDrawdownDollars > 0 ? "tone-down" : "tone-neutral" },
    { label: "Max daily DD", value: showWhenTrades(stats, fmtMoney(-stats.maxDailyDrawdownDollars)), tone: stats.maxDailyDrawdownDollars > 0 ? "tone-down" : "tone-neutral" },
    moneyStat("Max runup", stats.maxRunupDollars, stats.trades),
    ratioStat("Recovery", stats.recoveryFactor, 1, stats.trades),
    { label: "Ulcer index", value: showWhenTrades(stats, fmtMoney(-stats.ulcerIndexDollars)), tone: stats.ulcerIndexDollars > 0 ? "tone-down" : "tone-neutral" },
    { label: "Pain index", value: showWhenTrades(stats, fmtMoney(-stats.painIndexDollars)), tone: stats.painIndexDollars > 0 ? "tone-down" : "tone-neutral" },
    { label: "Underwater days", value: showWhenTrades(stats, fmtPct(stats.underwaterDaysPct)), tone: statTone(stats.underwaterDaysPct, false) as StatTone },
    { label: "Equity highs", value: showWhenTrades(stats, fmtCount(stats.equityHighs)), tone: "tone-neutral" },
    { label: "Current drawdown", value: showWhenTrades(stats, fmtMoney(-stats.currentDrawdownDollars)), tone: stats.currentDrawdownDollars > 0 ? "tone-down" : "tone-neutral" },
    { label: "Current underwater", value: showWhenTrades(stats, `${fmtCount(stats.currentUnderwaterDays)} days`), tone: stats.currentUnderwaterDays > 0 ? "tone-down" : "tone-neutral" },
    { label: "Longest underwater", value: showWhenTrades(stats, `${fmtCount(stats.longestUnderwaterDays)} days`), tone: stats.longestUnderwaterDays > 0 ? "tone-down" : "tone-neutral" },
    { label: "Trade downside dev", value: showWhenTrades(stats, fmtMoney(stats.tradeDownsideDeviationDollars)), tone: "tone-neutral" },
    { label: "Trade MAD", value: showWhenTrades(stats, fmtMoney(stats.tradeMedianAbsoluteDeviationDollars)), tone: "tone-neutral", title: "Median absolute deviation: robust dispersion less influenced by outliers" },
    { label: "Trade IQR", value: showWhenTrades(stats, fmtMoney(stats.tradeIqrDollars)), tone: "tone-neutral", title: "Middle 50% spread of trade P&L" },
    moneyStat("5% VaR", stats.p05TradeDollars, stats.trades),
    moneyStat("5% CVaR", stats.cvarLossDollars, stats.trades),
    moneyStat("10th pct trade", stats.p10TradeDollars, stats.trades),
    moneyStat("90th pct trade", stats.p90TradeDollars, stats.trades),
    moneyStat("95th pct trade", stats.p95TradeDollars, stats.trades),
    moneyStat("Top-tail avg", stats.cvarWinDollars, stats.trades),
    ratioStat("Tail ratio", stats.tailRatio, 1, stats.trades),
    moneyStat("Worst trade", stats.worstTradeDollars, stats.trades)
  ];

  const streakStats: StatCardData[] = [
    { label: "Wins", value: showWhenTrades(stats, fmtCount(stats.wins)), tone: "tone-up" },
    { label: "Losses", value: showWhenTrades(stats, fmtCount(stats.losses)), tone: "tone-down" },
    { label: "Breakevens", value: showWhenTrades(stats, fmtCount(stats.breakevens)), tone: "tone-neutral" },
    { label: "Loss rate", value: showWhenTrades(stats, fmtPct(stats.lossRatePct)), tone: stats.lossRatePct > 50 ? "tone-down" : "tone-neutral" },
    { label: "Longest wins", value: showWhenTrades(stats, fmtCount(stats.longestWinStreak)), tone: "tone-up" },
    { label: "Longest losses", value: showWhenTrades(stats, fmtCount(stats.longestLossStreak)), tone: stats.longestLossStreak >= 3 ? "tone-down" : "tone-neutral" },
    {
      label: "Current streak",
      value: showWhenTrades(stats, `${stats.currentStreakLabel} ${fmtCount(stats.currentStreakCount)}`),
      tone: stats.currentStreakLabel === "Win" ? "tone-up" : stats.currentStreakLabel === "Loss" ? "tone-down" : "tone-neutral"
    },
    moneyStat("Best win streak", stats.bestWinStreakDollars, stats.trades),
    moneyStat("Worst loss streak", stats.worstLossStreakDollars, stats.trades),
    moneyStat("Best 3 trades", stats.bestThreeTradesDollars, stats.trades),
    moneyStat("Worst 3 trades", stats.worstThreeTradesDollars, stats.trades),
    moneyStat("Best 5 trades", stats.bestFiveTradesDollars, stats.trades),
    moneyStat("Worst 5 trades", stats.worstFiveTradesDollars, stats.trades),
    moneyStat("After win avg", stats.avgAfterWinDollars, stats.trades),
    moneyStat("After loss avg", stats.avgAfterLossDollars, stats.trades),
    { label: "Win after win", value: showWhenTrades(stats, fmtPct(stats.winAfterWinPct)), tone: stats.winAfterWinPct >= stats.winRatePct ? "tone-up" : "tone-neutral" },
    { label: "Win after loss", value: showWhenTrades(stats, fmtPct(stats.winAfterLossPct)), tone: stats.winAfterLossPct >= stats.winRatePct ? "tone-up" : "tone-neutral" },
    { label: "Lag-1 correlation", value: showWhenTrades(stats, fmtNumber(stats.lagOneCorrelation)), tone: Math.abs(stats.lagOneCorrelation) >= 0.3 ? "tone-down" : "tone-neutral", title: "Correlation between each trade's R result and the next trade" },
    { label: "Outcome runs", value: showWhenTrades(stats, fmtCount(stats.runsCount)), tone: "tone-neutral" },
    { label: "Runs z-score", value: showWhenTrades(stats, fmtNumber(stats.runsZScore)), tone: Math.abs(stats.runsZScore) >= 1.96 ? "tone-down" : "tone-neutral", title: "Wald-Wolfowitz runs test; magnitude above 1.96 suggests non-random sequencing" },
    { label: "Longest breakevens", value: showWhenTrades(stats, fmtCount(stats.longestBreakevenStreak)), tone: "tone-neutral" },
    moneyStat("Best trade", stats.bestTradeDollars, stats.trades)
  ];

  const timingStats: StatCardData[] = [
    { label: "Start date", value: showWhenTrades(stats, <LocalDateTimeStack value={stats.start} />), tone: "tone-neutral", className: "date-stat-card" },
    {
      label: "End date",
      value: showWhenTrades(stats, <LocalDateTimeStack value={latestEndDate(dataEndAt, stats.end)} />),
      tone: "tone-neutral",
      className: "date-stat-card"
    },
    { label: "Calendar days", value: showWhenTrades(stats, fmtCount(stats.calendarDays)), tone: "tone-neutral" },
    { label: "Active days", value: showWhenTrades(stats, fmtCount(stats.activeDays)), tone: "tone-neutral" },
    { label: "Active day rate", value: showWhenTrades(stats, fmtPct(stats.activeDayRatePct)), tone: "tone-neutral" },
    { label: "Trades / day", value: showWhenTrades(stats, fmtNumber(stats.tradesPerDay)), tone: "tone-neutral" },
    { label: "Trades / week", value: showWhenTrades(stats, fmtNumber(stats.tradesPerWeek)), tone: "tone-neutral" },
    { label: "Trades / month", value: showWhenTrades(stats, fmtNumber(stats.tradesPerMonth)), tone: "tone-neutral" },
    { label: "Trades / year", value: showWhenTrades(stats, fmtNumber(stats.tradesPerYear)), tone: "tone-neutral" },
    { label: "Exposure", value: showWhenTrades(stats, fmtPct(stats.exposurePct)), tone: stats.exposurePct > 100 ? "tone-down" : "tone-neutral" },
    { label: "Avg duration", value: showWhenTrades(stats, fmtDurationMs(stats.avgDurationMs)), tone: "tone-neutral" },
    { label: "Median duration", value: showWhenTrades(stats, fmtDurationMs(stats.medianDurationMs)), tone: "tone-neutral" },
    { label: "Shortest trade", value: showWhenTrades(stats, fmtDurationMs(stats.shortestDurationMs)), tone: "tone-neutral" },
    { label: "Longest trade", value: showWhenTrades(stats, fmtDurationMs(stats.longestDurationMs)), tone: "tone-neutral" },
    { label: "Win duration", value: showWhenTrades(stats, fmtDurationMs(stats.avgWinDurationMs)), tone: "tone-up" },
    { label: "Loss duration", value: showWhenTrades(stats, fmtDurationMs(stats.avgLossDurationMs)), tone: "tone-down" },
    { label: "Avg entry gap", value: showWhenTrades(stats, fmtDurationMs(stats.avgGapMs)), tone: "tone-neutral" },
    { label: "Median gap", value: showWhenTrades(stats, fmtDurationMs(stats.medianGapMs)), tone: "tone-neutral" },
    { label: "Shortest gap", value: showWhenTrades(stats, fmtDurationMs(stats.shortestGapMs)), tone: "tone-neutral" },
    { label: "Longest gap", value: showWhenTrades(stats, fmtDurationMs(stats.longestGapMs)), tone: "tone-neutral" },
    { label: "Avg bars held", value: showWhenTrades(stats, fmtNumber(stats.avgBarsHeld)), tone: "tone-neutral" },
    { label: "Max bars held", value: showWhenTrades(stats, fmtNumber(stats.maxBarsHeld)), tone: "tone-neutral" },
    { label: "Duration IQR", value: showWhenTrades(stats, fmtDurationMs(stats.durationIqrMs)), tone: "tone-neutral" },
    { label: "Duration std dev", value: showWhenTrades(stats, fmtDurationMs(stats.durationStdDevMs)), tone: "tone-neutral" },
    { label: "Gap IQR", value: showWhenTrades(stats, fmtDurationMs(stats.gapIqrMs)), tone: "tone-neutral" },
    { label: "Gap std dev", value: showWhenTrades(stats, fmtDurationMs(stats.gapStdDevMs)), tone: "tone-neutral" },
    { label: "Trades / active day", value: showWhenTrades(stats, fmtNumber(stats.tradesPerActiveDay)), tone: "tone-neutral" },
    { label: "Peak trades / day", value: showWhenTrades(stats, fmtCount(stats.maxTradesPerActiveDay)), tone: "tone-neutral" },
    { label: "Max concurrent", value: showWhenTrades(stats, fmtCount(stats.maxConcurrentTrades)), tone: "tone-neutral" },
    { label: "Overlap rate", value: showWhenTrades(stats, fmtPct(stats.overlapRatePct)), tone: stats.overlapRatePct > 50 ? "tone-down" : "tone-neutral", title: "Share of entries opened while another trade was already active" }
  ];

  const tradeShapeStats: StatCardData[] = [
    moneyStat("Avg risk", stats.avgRiskDollars, stats.trades, false, false),
    moneyStat("Median risk", stats.medianRiskDollars, stats.trades, false, false),
    moneyStat("Avg target", stats.avgTargetDollars, stats.trades, false),
    moneyStat("Median target", stats.medianTargetDollars, stats.trades, false),
    { label: "Dollar payoff", value: showWhenTrades(stats, fmtRiskReward(stats.rewardRiskRatio)), tone: ratioTone(stats.rewardRiskRatio, 1) as StatTone },
    { label: "R payoff", value: showWhenTrades(stats, fmtRiskReward(stats.rRewardRiskRatio)), tone: ratioTone(stats.rRewardRiskRatio, 1) as StatTone },
    moneyStat("Average win", stats.avgWinDollars, stats.wins),
    moneyStat("Average loss", stats.avgLossDollars, stats.losses),
    moneyStat("Median win", stats.medianWinDollars, stats.wins),
    moneyStat("Median loss", stats.medianLossDollars, stats.losses),
    { label: "Avg win R", value: showWhenTrades(stats, fmtR(stats.avgWinR, true)), tone: "tone-up" },
    { label: "Avg loss R", value: showWhenTrades(stats, fmtR(stats.avgLossR, true)), tone: "tone-down" },
    { label: "BE win rate", value: showWhenTrades(stats, fmtPct(stats.breakEvenWinRatePct)), tone: "tone-neutral" },
    { label: "Target capture", value: showWhenTrades(stats, fmtMaybePct(stats.avgWinToTargetPct)), tone: stats.avgWinToTargetPct >= 80 ? "tone-up" : "tone-neutral" },
    { label: "Risk capture", value: showWhenTrades(stats, fmtMaybePct(stats.avgLossToRiskPct)), tone: stats.avgLossToRiskPct <= 100 ? "tone-neutral" : "tone-down" },
    { label: "Target exits", value: showWhenTrades(stats, fmtCount(stats.targetExitCount)), tone: "tone-up" },
    { label: "Target hit rate", value: showWhenTrades(stats, fmtPct(stats.targetExitRatePct)), tone: stats.targetExitRatePct >= 50 ? "tone-up" : "tone-neutral" },
    { label: "Stop exits", value: showWhenTrades(stats, fmtCount(stats.stopExitCount)), tone: "tone-down" },
    { label: "Stop rate", value: showWhenTrades(stats, fmtPct(stats.stopExitRatePct)), tone: stats.stopExitRatePct >= 50 ? "tone-down" : "tone-neutral" },
    { label: "Other exits", value: showWhenTrades(stats, fmtCount(stats.otherExitCount)), tone: "tone-neutral" },
    segmentTextStat("Common exit", stats.commonExitReason, "share"),
    { label: "Risk IQR", value: showWhenTrades(stats, fmtMoney(stats.riskIqrDollars)), tone: "tone-neutral" },
    { label: "Target IQR", value: showWhenTrades(stats, fmtMoney(stats.targetIqrDollars)), tone: "tone-neutral" },
    { label: "Risk variability", value: showWhenTrades(stats, fmtPct(stats.riskCoefficientVariationPct)), tone: stats.riskCoefficientVariationPct > 50 ? "tone-down" : "tone-neutral", title: "Risk-size coefficient of variation" },
    { label: "Target variability", value: showWhenTrades(stats, fmtPct(stats.targetCoefficientVariationPct)), tone: "tone-neutral", title: "Target-size coefficient of variation" }
  ];

  const calendarStats: StatCardData[] = [
    { label: "Active months", value: showWhenTrades(stats, fmtCount(stats.activeMonths)), tone: "tone-neutral" },
    moneyStat("Avg month", stats.avgMonthlyDollars, stats.trades),
    moneyStat("Median month", stats.medianMonthlyDollars, stats.trades),
    { label: "Monthly std dev", value: showWhenTrades(stats, fmtMoney(stats.stdDevMonthlyDollars)), tone: "tone-neutral" },
    {
      ...moneyStat(stats.trades ? `Best month - ${stats.bestMonthPeriod}` : "Best month", stats.bestMonthDollars, stats.trades),
      title: stats.trades ? stats.bestMonthPeriod : undefined
    },
    {
      ...moneyStat(stats.trades ? `Worst month - ${stats.worstMonthPeriod}` : "Worst month", stats.worstMonthDollars, stats.trades),
      title: stats.trades ? stats.worstMonthPeriod : undefined
    },
    { label: "Winning months", value: showWhenTrades(stats, fmtCount(stats.winningMonths)), tone: "tone-up" },
    { label: "Losing months", value: showWhenTrades(stats, fmtCount(stats.losingMonths)), tone: "tone-down" },
    {
      label: "Month win rate",
      value: showWhenTrades(stats, fmtPct(stats.winningMonthRatePct)),
      tone: stats.winningMonthRatePct >= 50 ? "tone-up" : "tone-neutral"
    },
    ratioStat("Monthly PF", stats.monthlyProfitFactor, 1, stats.trades),
    moneyStat("Avg day", stats.avgDailyDollars, stats.trades),
    moneyStat("Avg active day", stats.avgActiveDayDollars, stats.trades),
    moneyStat("Best day", stats.bestDayDollars, stats.trades),
    moneyStat("Worst day", stats.worstDayDollars, stats.trades),
    moneyStat("Best 3 days", stats.bestThreeDaysDollars, stats.trades),
    moneyStat("Worst 3 days", stats.worstThreeDaysDollars, stats.trades),
    moneyStat("Best 5 days", stats.bestFiveDaysDollars, stats.trades),
    moneyStat("Worst 5 days", stats.worstFiveDaysDollars, stats.trades),
    { label: "Winning days", value: showWhenTrades(stats, fmtCount(stats.winningDays)), tone: "tone-up" },
    { label: "Losing days", value: showWhenTrades(stats, fmtCount(stats.losingDays)), tone: "tone-down" },
    { label: "Day win rate", value: showWhenTrades(stats, fmtPct(stats.winningDayRatePct)), tone: stats.winningDayRatePct >= 50 ? "tone-up" : "tone-neutral" },
    ratioStat("Daily PF", stats.dailyProfitFactor, 1, stats.trades),
    moneyStat("Median active day", stats.medianDailyDollars, stats.trades),
    { label: "Daily std dev", value: showWhenTrades(stats, fmtMoney(stats.stdDevDailyDollars)), tone: "tone-neutral" },
    { label: "Active weeks", value: showWhenTrades(stats, fmtCount(stats.activeWeeks)), tone: "tone-neutral" },
    moneyStat("Avg week", stats.avgWeeklyDollars, stats.trades),
    { label: "Week win rate", value: showWhenTrades(stats, fmtPct(stats.winningWeekRatePct)), tone: stats.winningWeekRatePct >= 50 ? "tone-up" : "tone-neutral" },
    moneyStat("Best week", stats.bestWeekDollars, stats.trades),
    moneyStat("Worst week", stats.worstWeekDollars, stats.trades),
    { label: "Active quarters", value: showWhenTrades(stats, fmtCount(stats.activeQuarters)), tone: "tone-neutral" },
    moneyStat("Avg quarter", stats.avgQuarterlyDollars, stats.trades),
    { label: "Quarter win rate", value: showWhenTrades(stats, fmtPct(stats.winningQuarterRatePct)), tone: stats.winningQuarterRatePct >= 50 ? "tone-up" : "tone-neutral" },
    segmentTextStat("Best weekday", stats.weekdays.best, "avg", "tone-up"),
    segmentTextStat("Worst weekday", stats.weekdays.worst, "avg", "tone-down"),
    segmentTextStat("Best entry hour", stats.entryHours.best, "avg", "tone-up"),
    segmentTextStat("Worst entry hour", stats.entryHours.worst, "avg", "tone-down"),
    segmentTextStat("Best calendar month", stats.months.best, "avg", "tone-up"),
    segmentTextStat("Worst calendar month", stats.months.worst, "avg", "tone-down")
  ];

  const rStats: StatCardData[] = [
    { label: "Total R", value: showWhenTrades(stats, fmtR(stats.totalR, true)), tone: statTone(stats.totalR) as StatTone },
    { label: "Avg R", value: showWhenTrades(stats, fmtR(stats.avgR, true)), tone: statTone(stats.avgR) as StatTone },
    { label: "Median R", value: showWhenTrades(stats, fmtR(stats.medianR, true)), tone: statTone(stats.medianR) as StatTone },
    { label: "Std dev R", value: showWhenTrades(stats, fmtR(stats.stdDevR)), tone: "tone-neutral" },
    { label: "Best R", value: showWhenTrades(stats, fmtR(stats.bestR, true)), tone: "tone-up" },
    { label: "Worst R", value: showWhenTrades(stats, fmtR(stats.worstR, true)), tone: "tone-down" },
    { label: "10th pct R", value: showWhenTrades(stats, fmtR(stats.p10R, true)), tone: statTone(stats.p10R) as StatTone },
    { label: "25th pct R", value: showWhenTrades(stats, fmtR(stats.p25R, true)), tone: statTone(stats.p25R) as StatTone },
    { label: "75th pct R", value: showWhenTrades(stats, fmtR(stats.p75R, true)), tone: statTone(stats.p75R) as StatTone },
    { label: "90th pct R", value: showWhenTrades(stats, fmtR(stats.p90R, true)), tone: statTone(stats.p90R) as StatTone },
    { label: "5th pct R", value: showWhenTrades(stats, fmtR(stats.p05R, true)), tone: statTone(stats.p05R) as StatTone },
    { label: "95th pct R", value: showWhenTrades(stats, fmtR(stats.p95R, true)), tone: statTone(stats.p95R) as StatTone },
    { label: "5% CVaR R", value: showWhenTrades(stats, fmtR(stats.cvarLossR, true)), tone: "tone-down" },
    { label: "R downside dev", value: showWhenTrades(stats, fmtR(stats.downsideDeviationR)), tone: "tone-neutral" },
    { label: "R MAD", value: showWhenTrades(stats, fmtR(stats.medianAbsoluteDeviationR)), tone: "tone-neutral" },
    { label: "R IQR", value: showWhenTrades(stats, fmtR(stats.iqrR)), tone: "tone-neutral" },
    { label: "Skew", value: showWhenTrades(stats, fmtNumber(stats.skewR)), tone: statTone(stats.skewR) as StatTone },
    { label: "Excess kurt", value: showWhenTrades(stats, fmtNumber(stats.excessKurtosisR)), tone: stats.excessKurtosisR > 3 ? "tone-down" : "tone-neutral" }
  ];

  const concentrationStats: StatCardData[] = [
    { label: "Models", value: showWhenTrades(stats, fmtCount(stats.strategies.count)), tone: "tone-neutral" },
    { label: "Effective models", value: showWhenTrades(stats, fmtNumber(stats.strategies.effectiveCount)), tone: "tone-neutral" },
    { label: "Top model share", value: showWhenTrades(stats, fmtPct(stats.strategies.largestSharePct)), tone: stats.strategies.largestSharePct > 50 ? "tone-down" : "tone-neutral" },
    { label: "Top 3 model share", value: showWhenTrades(stats, fmtPct(stats.strategies.topThreeSharePct)), tone: stats.strategies.topThreeSharePct > 80 ? "tone-down" : "tone-neutral" },
    { label: "Model breadth", value: showWhenTrades(stats, fmtPct(stats.strategies.profitablePct)), tone: stats.strategies.profitablePct >= 50 ? "tone-up" : "tone-neutral", title: "Share of models with positive net P&L" },
    { label: "Model entropy count", value: showWhenTrades(stats, fmtNumber(stats.strategies.entropyEffectiveCount)), tone: "tone-neutral", title: "Shannon-entropy effective number of independently sized model buckets" },
    { label: "Top model profit", value: showWhenTrades(stats, fmtPct(stats.strategies.profitContributionPct)), tone: stats.strategies.profitContributionPct > 50 ? "tone-down" : "tone-neutral", title: "Best model's share of all positive model profit" },
    segmentTextStat("Best model", stats.strategies.best, "total", "tone-up"),
    segmentTextStat("Worst model", stats.strategies.worst, "total", "tone-down"),
    { label: "Symbols", value: showWhenTrades(stats, fmtCount(stats.symbols.count)), tone: "tone-neutral" },
    { label: "Effective symbols", value: showWhenTrades(stats, fmtNumber(stats.symbols.effectiveCount)), tone: "tone-neutral" },
    { label: "Top symbol share", value: showWhenTrades(stats, fmtPct(stats.symbols.largestSharePct)), tone: stats.symbols.largestSharePct > 50 ? "tone-down" : "tone-neutral" },
    { label: "Top 3 symbol share", value: showWhenTrades(stats, fmtPct(stats.symbols.topThreeSharePct)), tone: stats.symbols.topThreeSharePct > 80 ? "tone-down" : "tone-neutral" },
    { label: "Symbol breadth", value: showWhenTrades(stats, fmtPct(stats.symbols.profitablePct)), tone: stats.symbols.profitablePct >= 50 ? "tone-up" : "tone-neutral", title: "Share of symbols with positive net P&L" },
    { label: "Symbol entropy count", value: showWhenTrades(stats, fmtNumber(stats.symbols.entropyEffectiveCount)), tone: "tone-neutral", title: "Shannon-entropy effective number of independently sized symbol buckets" },
    { label: "Top symbol profit", value: showWhenTrades(stats, fmtPct(stats.symbols.profitContributionPct)), tone: stats.symbols.profitContributionPct > 50 ? "tone-down" : "tone-neutral", title: "Best symbol's share of all positive symbol profit" },
    segmentTextStat("Best symbol", stats.symbols.best, "total", "tone-up"),
    segmentTextStat("Worst symbol", stats.symbols.worst, "total", "tone-down"),
    { label: "Markets", value: showWhenTrades(stats, fmtCount(stats.markets.count)), tone: "tone-neutral" },
    segmentTextStat("Best market", stats.markets.best, "total", "tone-up"),
    segmentTextStat("Worst market", stats.markets.worst, "total", "tone-down"),
    { label: "Phases", value: showWhenTrades(stats, fmtCount(stats.phases.count)), tone: "tone-neutral" },
    segmentTextStat("Best phase", stats.phases.best, "total", "tone-up"),
    segmentTextStat("Worst phase", stats.phases.worst, "total", "tone-down"),
    segmentTextStat("Best side", stats.sides.best, "total", "tone-up"),
    segmentTextStat("Worst side", stats.sides.worst, "total", "tone-down")
  ];

  const chartTrades = [...selectedTradeSnapshots].sort((left, right) => {
    const leftTime = Number.isFinite(left.exitMs) ? left.exitMs : left.entryMs;
    const rightTime = Number.isFinite(right.exitMs) ? right.exitMs : right.entryMs;
    return leftTime - rightTime;
  });
  let chartEquity = 0;
  const equityData = chartSample(
    chartTrades.map((trade, index) => {
      chartEquity += trade.pnlDollars;
      return { label: `Trade ${index + 1}`, value: chartEquity };
    })
  );
  let rollingTotal = 0;
  const rollingExpectancyData = chartSample(
    chartTrades.map((trade, index) => {
      rollingTotal += trade.pnlDollars;
      return { label: `Trade ${index + 1}`, value: rollingTotal / (index + 1) };
    })
  );
  const drawdownData = chartSample(stats.dailyCurve.map((point) => ({ label: point.dayKey, value: -point.drawdown })));
  const pnlHistogram = histogramData(chartTrades.map((trade) => trade.pnlDollars));
  const outcomeData = chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: trade.rMultiple }));
  const conditionalWinData: ChartDatum[] = [
    { label: "After win", value: stats.winAfterWinPct },
    { label: "After loss", value: stats.winAfterLossPct },
    { label: "Overall", value: stats.winRatePct }
  ];
  const durationData = chartSample(
    chartTrades.map((trade, index) => ({ label: `${index + 1}`, value: trade.durationMs / 3_600_000 })),
    36
  );
  const entryHourData = categoryChartData(chartTrades, (trade) => localHourLabel(trade.entryTime), () => 1, 24).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
  const riskTargetData = chartTrades.map((trade, index) => ({
    label: `Trade ${index + 1}`,
    value: trade.riskDollars,
    secondary: trade.targetDollars
  }));
  const exitMixData: ChartDatum[] = [
    { label: "Target", value: stats.targetExitCount },
    { label: "Stop", value: stats.stopExitCount },
    { label: "Other", value: stats.otherExitCount }
  ];
  const monthlyChartData = categoryChartData(chartTrades, (trade) => localTradeMonthKey(trade.exitTime), (trade) => trade.pnlDollars, 24).sort(
    (left, right) => left.label.localeCompare(right.label)
  );
  const weekdayChartData = categoryChartData(chartTrades, (trade) => localWeekdayLabel(trade.entryTime), (trade) => trade.pnlDollars, 7)
    .map((point) => ({ ...point, value: point.secondary ? point.value / point.secondary : 0 }))
    .sort((left, right) => WEEKDAY_LABELS.indexOf(left.label as (typeof WEEKDAY_LABELS)[number]) - WEEKDAY_LABELS.indexOf(right.label as (typeof WEEKDAY_LABELS)[number]));
  const rHistogram = histogramData(chartTrades.map((trade) => trade.rMultiple));
  const rPercentileData: ChartDatum[] = [
    { label: "P5", value: stats.p05R },
    { label: "P10", value: stats.p10R },
    { label: "P25", value: stats.p25R },
    { label: "P50", value: stats.medianR },
    { label: "P75", value: stats.p75R },
    { label: "P90", value: stats.p90R },
    { label: "P95", value: stats.p95R }
  ];
  const modelAllocationData = categoryChartData(chartTrades, (trade) => trade.strategyLabel, () => 1, 8);
  const symbolAllocationData = categoryChartData(chartTrades, (trade) => trade.symbolLabel, () => 1, 8);
  const tradePnlData: ChartDatum[] = chartSample(chartTrades.map((trade, index) => ({
    label: `Trade ${index + 1}`,
    value: trade.pnlDollars,
    detail: `${trade.symbolLabel} · ${trade.strategyLabel}`
  })), 48);
  const tradeRData: ChartDatum[] = chartSample(chartTrades.map((trade, index) => ({
    label: `Trade ${index + 1}`,
    value: trade.rMultiple,
    detail: `${trade.symbolLabel} · ${trade.sideLabel}`
  })), 48);
  let cumulativeR = 0;
  const cumulativeRData = chartSample(chartTrades.map((trade, index) => {
    cumulativeR += trade.rMultiple;
    return { label: `Trade ${index + 1}`, value: cumulativeR, detail: `${fmtR(trade.rMultiple, true)} added on this trade` };
  }));
  const rollingPnlData = chartSample(rollingChartData(chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: trade.pnlDollars })), 20));
  const rollingRData = chartSample(rollingChartData(chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: trade.rMultiple })), 20));
  const modelPnlData = categoryChartData(chartTrades, (trade) => trade.strategyLabel, (trade) => trade.pnlDollars, 10);
  const symbolPnlData = categoryChartData(chartTrades, (trade) => trade.symbolLabel, (trade) => trade.pnlDollars, 10);
  const grossSplitData: ChartDatum[] = [
    { label: "Gross profit", value: stats.grossWinDollars, detail: `${fmtCount(stats.wins)} winning trades` },
    { label: "Gross loss", value: stats.grossLossDollars, detail: `${fmtCount(stats.losses)} losing trades` }
  ];
  const riskSequenceData = chartSample(chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: trade.riskDollars, detail: `${trade.symbolLabel} planned risk` })), 48);
  const targetSequenceData = chartSample(chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: trade.targetDollars, detail: `${trade.symbolLabel} planned target` })), 48);
  const downsideSequenceData = chartSample(chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: Math.min(0, trade.pnlDollars), detail: trade.pnlDollars < 0 ? `${trade.symbolLabel} realized loss` : "No downside on this trade" })), 48);
  const tailProfileData: ChartDatum[] = [
    { label: "P5", value: stats.p05TradeDollars }, { label: "P10", value: stats.p10TradeDollars },
    { label: "P25", value: stats.p25TradeDollars }, { label: "Median", value: stats.p50TradeDollars },
    { label: "P75", value: stats.p75TradeDollars }, { label: "P90", value: stats.p90TradeDollars },
    { label: "P95", value: stats.p95TradeDollars }
  ];
  const underwaterData = chartSample(stats.dailyCurve.map((point) => ({ label: point.dayKey, value: point.drawdown > 0 ? 1 : 0, detail: point.drawdown > 0 ? `${fmtMoney(point.drawdown)} below peak` : "At a new equity high" })));
  const dailyPnlData = chartSample(stats.dailyCurve.map((point) => ({ label: point.dayKey, value: point.pnl, detail: `Equity ${fmtMoney(point.equity, true)}` })));
  const riskPnlScatter = chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: trade.riskDollars, secondary: trade.pnlDollars, detail: `${trade.symbolLabel} · ${trade.strategyLabel}` }));
  const rollingWinRateData = chartSample(rollingChartData(chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: trade.rMultiple > 0 ? 100 : 0 })), 20));
  let activeStreak = 0;
  let priorSign = 0;
  const streakLengthData = chartSample(chartTrades.map((trade, index) => {
    const sign = Math.sign(trade.rMultiple);
    activeStreak = sign !== 0 && sign === priorSign ? activeStreak + 1 : sign === 0 ? 0 : 1;
    priorSign = sign;
    return { label: `Trade ${index + 1}`, value: sign < 0 ? -activeStreak : activeStreak, detail: sign > 0 ? "Winning streak" : sign < 0 ? "Losing streak" : "Breakeven reset" };
  }));
  let cumulativeWins = 0;
  let cumulativeLosses = 0;
  const cumulativeOutcomeData = chartSample(chartTrades.map((trade, index) => {
    if (trade.rMultiple > 0) cumulativeWins += 1;
    if (trade.rMultiple < 0) cumulativeLosses += 1;
    return { label: `Trade ${index + 1}`, value: cumulativeWins, secondary: cumulativeLosses, detail: `${cumulativeWins + cumulativeLosses} decided outcomes` };
  }));
  const sideExpectancyData = averageCategoryData(categoryChartData(chartTrades, (trade) => trade.sideLabel, (trade) => trade.pnlDollars, 4));
  const modelWinRateData = averageCategoryData(categoryChartData(chartTrades, (trade) => trade.strategyLabel, (trade) => trade.rMultiple > 0 ? 100 : 0, 10));
  const outcomeMixData: ChartDatum[] = [
    { label: "Wins", value: stats.wins, detail: fmtPct(stats.winRatePct) },
    { label: "Losses", value: stats.losses, detail: fmtPct(stats.lossRatePct) },
    { label: "Breakeven", value: stats.breakevens, detail: "Zero-R results" }
  ];
  const weekdayCountData = categoryChartData(chartTrades, (trade) => localWeekdayLabel(trade.entryTime), () => 1, 7);
  const monthCountData = categoryChartData(chartTrades, (trade) => localTradeMonthKey(trade.entryTime), () => 1, 18).sort((a, b) => a.label.localeCompare(b.label));
  const sortedByEntry = [...chartTrades].sort((a, b) => a.entryMs - b.entryMs);
  const gapSequenceData = chartSample(sortedByEntry.slice(1).map((trade, index) => ({ label: `Gap ${index + 1}`, value: (trade.entryMs - sortedByEntry[index]!.entryMs) / 3_600_000, detail: `Before ${trade.symbolLabel}` })), 48);
  const barsHeldData = chartSample(chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: trade.barsHeld, detail: `${trade.symbolLabel} · ${trade.durationMs > 0 ? fmtDurationMs(trade.durationMs) : "--"}` })), 48);
  const durationOutcomeData = averageCategoryData(categoryChartData(chartTrades, (trade) => outcomeForChartTrade(trade), (trade) => trade.durationMs / 3_600_000, 4));
  const dayActivityData = categoryChartData(chartTrades, (trade) => localTradeDayKey(trade.entryTime), () => 1, 24).sort((a, b) => a.label.localeCompare(b.label));
  const targetRiskRatioData = chartSample(chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: trade.riskDollars > 0 ? trade.targetDollars / trade.riskDollars : 0, detail: `${trade.symbolLabel} planned reward/risk` })), 48);
  const sideMixData = categoryChartData(chartTrades, (trade) => trade.sideLabel, () => 1, 4);
  const exitReasonData = categoryChartData(chartTrades, (trade) => trade.exitBucket, () => 1, 10);
  let cumulativeMonthPnl = 0;
  const cumulativeMonthlyData = monthlyChartData.map((point) => {
    cumulativeMonthPnl += point.value;
    return { ...point, value: cumulativeMonthPnl, detail: `${fmtMoney(point.value, true)} during this month` };
  });
  const weeklyPnlData = categoryChartData(chartTrades, (trade) => localTradeWeekKey(trade.exitTime), (trade) => trade.pnlDollars, 24).sort((a, b) => a.label.localeCompare(b.label));
  const calendarMonthAvgData = averageCategoryData(categoryChartData(chartTrades, (trade) => localMonthLabel(trade.entryTime), (trade) => trade.pnlDollars, 12));
  const hourExpectancyData = averageCategoryData(categoryChartData(chartTrades, (trade) => localHourLabel(trade.entryTime), (trade) => trade.pnlDollars, 24)).sort((a, b) => a.label.localeCompare(b.label));
  const quarterPnlData = categoryChartData(chartTrades, (trade) => localTradeQuarterKey(trade.exitTime), (trade) => trade.pnlDollars, 16).sort((a, b) => a.label.localeCompare(b.label));
  const modelRData = averageCategoryData(categoryChartData(chartTrades, (trade) => trade.strategyLabel, (trade) => trade.rMultiple, 10));
  const rPnlScatter = chartTrades.map((trade, index) => ({ label: `Trade ${index + 1}`, value: trade.rMultiple, secondary: trade.pnlDollars, detail: `${trade.symbolLabel} · ${trade.strategyLabel}` }));
  const rTailData: ChartDatum[] = [
    { label: "Worst", value: stats.worstR }, { label: "5% CVaR", value: stats.cvarLossR },
    { label: "P5", value: stats.p05R }, { label: "P10", value: stats.p10R },
    { label: "P90", value: stats.p90R }, { label: "P95", value: stats.p95R }, { label: "Best", value: stats.bestR }
  ];
  const marketAllocationData = categoryChartData(chartTrades, (trade) => trade.marketLabel, () => 1, 8);
  const phaseAllocationData = categoryChartData(chartTrades, (trade) => trade.phaseLabel, () => 1, 8);
  const sidePnlData = categoryChartData(chartTrades, (trade) => trade.sideLabel, (trade) => trade.pnlDollars, 4);
  const exitAllocationData = categoryChartData(chartTrades, (trade) => trade.exitBucket, () => 1, 8);

  const statGroups = [
    {
      title: "Performance",
      stats: performanceStats,
      charts: [
        { title: "Equity curve", subtitle: "Cumulative realized P&L by trade", chart: <LineChart data={equityData} tooltipContext="Account equity" tooltipDetail={(point) => `Net realized result through ${point.label.toLowerCase()}`} /> },
        { title: "Rolling expectancy", subtitle: "Average P&L after each completed trade", chart: <LineChart data={rollingExpectancyData} tooltipContext="Expanding expectancy" tooltipDetail={(point) => `Average dollars earned per trade through ${point.label.toLowerCase()}`} /> },
        { title: "Cumulative R", subtitle: "Normalized equity independent of position size", chart: <LineChart data={cumulativeRData} formatValue={(value) => fmtR(value, true)} tooltipContext="Accumulated R" /> },
        { title: "Trade P&L tape", subtitle: "Realized dollar result in execution order", chart: <BarChart data={tradePnlData} tooltipContext="Realized trade P&L" /> },
        { title: "20-trade edge", subtitle: "Rolling short-window dollar expectancy", chart: <LineChart data={rollingPnlData} tooltipContext="20-trade expectancy" /> },
        { title: "Model contribution", subtitle: "Net P&L supplied by each leading strategy", chart: <BarChart data={modelPnlData} horizontal tooltipContext="Strategy contribution" tooltipDetail={(point) => `${fmtCount(point.secondary ?? 0)} trades generated this result`} /> },
        { title: "Symbol contribution", subtitle: "Net P&L supplied by each leading market", chart: <BarChart data={symbolPnlData} horizontal tooltipContext="Symbol contribution" tooltipDetail={(point) => `${fmtCount(point.secondary ?? 0)} trades contributed`} /> },
        { title: "Gross profit balance", subtitle: "Total winning dollars versus losing dollars", chart: <DonutChart data={grossSplitData} tooltipContext="Gross P&L composition" /> }
      ]
    },
    {
      title: "Risk & Tails",
      stats: riskStats,
      charts: [
        { title: "Drawdown path", subtitle: "Daily distance below the prior equity high", chart: <LineChart data={drawdownData} tooltipContext="Equity drawdown" tooltipDetail={(point) => `${point.label} distance from the prior high-water mark`} /> },
        { title: "P&L distribution", subtitle: "Trade frequency across dollar outcomes", chart: <BarChart data={pnlHistogram} formatValue={fmtCount} tooltipContext="Outcome frequency" tooltipDetail={(point) => `Trades near the ${point.label} P&L bucket`} /> },
        { title: "Planned risk tape", subtitle: "Dollar risk committed to each trade", chart: <BarChart data={riskSequenceData} tooltipContext="Planned downside" /> },
        { title: "Realized downside", subtitle: "Loss-only sequence with wins held at zero", chart: <BarChart data={downsideSequenceData} tooltipContext="Realized downside event" /> },
        { title: "Tail profile", subtitle: "Dollar outcomes from lower to upper tail", chart: <LineChart data={tailProfileData} tooltipContext="P&L percentile" tooltipDetail={(point) => `${point.label} of the realized trade distribution`} /> },
        { title: "Underwater timeline", subtitle: "Days below the previous equity peak", chart: <OutcomeStrip data={underwaterData} tooltipContext="Underwater state" /> },
        { title: "Daily shock tape", subtitle: "Calendar-day gains and losses", chart: <BarChart data={dailyPnlData} tooltipContext="Daily net result" /> },
        { title: "Risk efficiency map", subtitle: "Planned risk versus realized P&L", chart: <ScatterChart data={riskPnlScatter} tooltipContext="Risk efficiency" xLabel="Risk" yLabel="P&L" /> }
      ]
    },
    {
      title: "Streaks & Momentum",
      stats: streakStats,
      charts: [
        { title: "Outcome tape", subtitle: "Chronological wins, losses, and breakevens", chart: <OutcomeStrip data={outcomeData} tooltipContext="Chronological R outcome" /> },
        { title: "Conditional win rate", subtitle: "How the prior result changes the next outcome", chart: <BarChart data={conditionalWinData} formatValue={fmtPct} tooltipContext="Next-trade win probability" tooltipDetail={(point) => `${point.label} condition across all eligible transitions`} /> },
        { title: "Rolling win rate", subtitle: "Local hit rate across the latest 20 trades", chart: <LineChart data={rollingWinRateData} formatValue={fmtPct} tooltipContext="20-trade win rate" /> },
        { title: "Streak pressure", subtitle: "Positive and negative run length over time", chart: <BarChart data={streakLengthData} formatValue={fmtNumber} tooltipContext="Active streak length" /> },
        { title: "Cumulative decisions", subtitle: "Wins versus losses accumulated over time", chart: <LineChart data={cumulativeOutcomeData} formatValue={fmtCount} secondaryLabel="Losses" tooltipContext="Cumulative wins" /> },
        { title: "Side expectancy", subtitle: "Average dollars earned by long and short trades", chart: <BarChart data={sideExpectancyData} tooltipContext="Directional expectancy" /> },
        { title: "Model hit rate", subtitle: "Average win probability by strategy", chart: <BarChart data={modelWinRateData} formatValue={fmtPct} horizontal tooltipContext="Strategy win rate" /> },
        { title: "Outcome composition", subtitle: "Wins, losses, and breakevens as a whole", chart: <DonutChart data={outcomeMixData} tooltipContext="Outcome mix" /> }
      ]
    },
    {
      title: "Timing & Cadence",
      stats: timingStats,
      charts: [
        { title: "Holding time", subtitle: "Trade duration in hours across the sample", chart: <BarChart data={durationData} formatValue={(value) => `${fmtNumber(value)}h`} tooltipContext="Trade holding time" /> },
        { title: "Entry clock", subtitle: "Number of entries by local hour", chart: <BarChart data={entryHourData} formatValue={fmtCount} tooltipContext="Hourly entry count" /> },
        { title: "Weekday activity", subtitle: "Execution frequency by weekday", chart: <BarChart data={weekdayCountData} formatValue={fmtCount} tooltipContext="Weekday trade volume" /> },
        { title: "Monthly activity", subtitle: "Execution count across recent active months", chart: <BarChart data={monthCountData} formatValue={fmtCount} tooltipContext="Monthly trade volume" /> },
        { title: "Entry gaps", subtitle: "Hours between consecutive entries", chart: <LineChart data={gapSequenceData} formatValue={(value) => `${fmtNumber(value)}h`} tooltipContext="Time between entries" /> },
        { title: "Bars held", subtitle: "Chart bars consumed by each position", chart: <BarChart data={barsHeldData} formatValue={fmtCount} tooltipContext="Bars in position" /> },
        { title: "Duration by outcome", subtitle: "Average holding hours for each result class", chart: <BarChart data={durationOutcomeData} formatValue={(value) => `${fmtNumber(value)}h`} tooltipContext="Outcome holding time" /> },
        { title: "Daily execution load", subtitle: "Trades entered on each recent active day", chart: <BarChart data={dayActivityData} formatValue={fmtCount} tooltipContext="Daily entry load" /> }
      ]
    },
    {
      title: "Trade Shape",
      stats: tradeShapeStats,
      charts: [
        { title: "Risk / target map", subtitle: "Planned dollars at risk versus planned reward", chart: <ScatterChart data={riskTargetData} tooltipContext="Bracket geometry" xLabel="Risk" yLabel="Target" /> },
        { title: "Exit mix", subtitle: "Target, stop, and discretionary exits", chart: <DonutChart data={exitMixData} tooltipContext="Exit route share" /> },
        { title: "Risk sizing", subtitle: "Planned risk consistency across trades", chart: <LineChart data={riskSequenceData} tooltipContext="Risk size" /> },
        { title: "Target sizing", subtitle: "Planned reward consistency across trades", chart: <LineChart data={targetSequenceData} tooltipContext="Target size" /> },
        { title: "Planned reward / risk", subtitle: "Target dollars divided by risk dollars", chart: <LineChart data={targetRiskRatioData} formatValue={fmtNumber} tooltipContext="Planned payoff ratio" /> },
        { title: "Risk versus outcome", subtitle: "Whether larger risk translated into larger P&L", chart: <ScatterChart data={riskPnlScatter} tooltipContext="Risk realization" xLabel="Risk" yLabel="P&L" /> },
        { title: "Directional mix", subtitle: "Long and short participation", chart: <DonutChart data={sideMixData} tooltipContext="Side allocation" /> },
        { title: "Exit reason volume", subtitle: "Frequency of each normalized exit path", chart: <BarChart data={exitReasonData} formatValue={fmtCount} horizontal tooltipContext="Exit reason frequency" /> }
      ]
    },
    {
      title: "Calendar Edge",
      stats: calendarStats,
      charts: [
        { title: "Monthly P&L", subtitle: "Net realized result by active month", chart: <BarChart data={monthlyChartData} tooltipContext="Monthly net P&L" /> },
        { title: "Weekday expectancy", subtitle: "Average trade P&L by entry weekday", chart: <BarChart data={weekdayChartData} tooltipContext="Weekday expectancy" /> },
        { title: "Daily P&L", subtitle: "Net result on every calendar day", chart: <LineChart data={dailyPnlData} tooltipContext="Calendar-day P&L" /> },
        { title: "Monthly equity", subtitle: "Cumulative result at each month end", chart: <LineChart data={cumulativeMonthlyData} tooltipContext="Month-end equity" /> },
        { title: "Weekly P&L", subtitle: "Net realized result by active week", chart: <BarChart data={weeklyPnlData} tooltipContext="Weekly net P&L" /> },
        { title: "Month-of-year edge", subtitle: "Average trade result by calendar month", chart: <BarChart data={calendarMonthAvgData} tooltipContext="Seasonal month expectancy" /> },
        { title: "Hour expectancy", subtitle: "Average result by local entry hour", chart: <BarChart data={hourExpectancyData} tooltipContext="Entry-hour expectancy" /> },
        { title: "Quarterly P&L", subtitle: "Net result across active quarters", chart: <BarChart data={quarterPnlData} tooltipContext="Quarterly net P&L" /> }
      ]
    },
    {
      title: "R-Multiple Anatomy",
      stats: rStats,
      charts: [
        { title: "R distribution", subtitle: "Trade frequency across normalized outcomes", chart: <BarChart data={rHistogram} formatValue={fmtCount} tooltipContext="R-multiple frequency" /> },
        { title: "R percentile profile", subtitle: "The result curve from left tail to right tail", chart: <LineChart data={rPercentileData} formatValue={(value) => fmtR(value, true)} tooltipContext="R percentile" /> },
        { title: "R sequence", subtitle: "Normalized outcome in execution order", chart: <BarChart data={tradeRData} formatValue={(value) => fmtR(value, true)} tooltipContext="Trade R result" /> },
        { title: "Cumulative R", subtitle: "Running normalized strategy equity", chart: <LineChart data={cumulativeRData} formatValue={(value) => fmtR(value, true)} tooltipContext="Cumulative R equity" /> },
        { title: "20-trade R edge", subtitle: "Rolling normalized expectancy", chart: <LineChart data={rollingRData} formatValue={(value) => fmtR(value, true)} tooltipContext="Rolling R expectancy" /> },
        { title: "R by model", subtitle: "Average normalized outcome by strategy", chart: <BarChart data={modelRData} formatValue={(value) => fmtR(value, true)} horizontal tooltipContext="Strategy R expectancy" /> },
        { title: "R / dollar map", subtitle: "Normalized result versus realized dollars", chart: <ScatterChart data={rPnlScatter} formatX={(value) => fmtR(value, true)} tooltipContext="R-dollar relationship" xLabel="R" yLabel="P&L" /> },
        { title: "R tail balance", subtitle: "Extremes and critical distribution cutoffs", chart: <BarChart data={rTailData} formatValue={(value) => fmtR(value, true)} tooltipContext="R tail marker" /> }
      ]
    },
    {
      title: "Concentration",
      stats: concentrationStats,
      charts: [
        { title: "Model allocation", subtitle: "Trade count across the busiest models", chart: <BarChart data={modelAllocationData} formatValue={fmtCount} horizontal tooltipContext="Model trade allocation" /> },
        { title: "Symbol allocation", subtitle: "Trade count across the busiest symbols", chart: <BarChart data={symbolAllocationData} formatValue={fmtCount} horizontal tooltipContext="Symbol trade allocation" /> },
        { title: "Model P&L", subtitle: "Net contribution by leading strategy", chart: <BarChart data={modelPnlData} horizontal tooltipContext="Model net contribution" /> },
        { title: "Symbol P&L", subtitle: "Net contribution by leading instrument", chart: <BarChart data={symbolPnlData} horizontal tooltipContext="Symbol net contribution" /> },
        { title: "Market allocation", subtitle: "Trade volume across market families", chart: <BarChart data={marketAllocationData} formatValue={fmtCount} horizontal tooltipContext="Market allocation" /> },
        { title: "Phase allocation", subtitle: "Trade volume across strategy phases", chart: <BarChart data={phaseAllocationData} formatValue={fmtCount} horizontal tooltipContext="Phase allocation" /> },
        { title: "Side contribution", subtitle: "Net dollars generated by long and short trades", chart: <BarChart data={sidePnlData} tooltipContext="Directional P&L contribution" /> },
        { title: "Exit allocation", subtitle: "Trade volume across exit paths", chart: <DonutChart data={exitAllocationData} tooltipContext="Exit concentration" /> }
      ]
    }
  ];

  return (
    <div
      className={`selectedStatsSurface${expanded ? " is-expanded" : ""}${toggleable ? " is-toggleable" : ""}`}
      role={toggleable ? "button" : undefined}
      tabIndex={toggleable ? 0 : undefined}
      aria-expanded={toggleable ? expanded : undefined}
      aria-label={toggleable ? (expanded ? "Collapse selected strategy stats" : "Expand selected strategy stats") : undefined}
      onClick={toggleable ? toggleExpanded : undefined}
      onKeyDown={(event) => {
        if (!toggleable) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleExpanded();
        }
      }}
    >
      <div className="backtest-stats-grid selectedStatsSummaryGrid">
        {summaryStats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>
      {expanded ? statGroups.map((group) => <StatGroup key={group.title} title={group.title} stats={group.stats} charts={group.charts} />) : null}
      {toggleable ? (
        <div className="selectedStatsToggleHint" aria-hidden="true">
          <span>{expanded ? "Hide details" : "More stats"}</span>
        </div>
      ) : null}
    </div>
  );
}
