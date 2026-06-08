"use client";

import { useState, type ReactNode } from "react";
import {
  strategyContractScale,
  strategyHasContractEdit,
  type StrategyEditOption,
  type StrategyEditSeedMap,
  useStrategyEdits
} from "@/components/strategies/strategy-edits-store";
import { LocalDateTimeStack } from "@/components/ui/local-date-time";

type BasketTrade = {
  key: string;
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
  effectiveCount: number;
};

type DollarAggregate = {
  activeDayRatePct: number;
  avgLossDollars: number;
  trades: number;
  breakevens: number;
  avgWinDollars: number;
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
  bestR: number;
  worstR: number;
  p10R: number;
  p25R: number;
  p75R: number;
  p90R: number;
  skewR: number;
  excessKurtosisR: number;
  avgDurationMs: number;
  avgWinDurationMs: number;
  avgLossDurationMs: number;
  medianDurationMs: number;
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
  shortestGapMs: number;
  longestGapMs: number;
  maxDailyDrawdownDollars: number;
  maxTradeDrawdownDollars: number;
  maxRunupDollars: number;
  recoveryFactor: number;
  ulcerIndexDollars: number;
  painIndexDollars: number;
  underwaterDaysPct: number;
  equityHighs: number;
  avgDailyDollars: number;
  avgActiveDayDollars: number;
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
  avgWinToTargetPct: number;
  avgLossToRiskPct: number;
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
  const effectiveCount = hhi > 0 ? 1 / hhi : 0;
  return {
    count: summaries.length,
    best: sortedByPnl[0] ?? null,
    worst: sortedByPnl[sortedByPnl.length - 1] ?? null,
    largest: sortedByShare[0] ?? null,
    largestSharePct: sortedByShare[0]?.sharePct ?? 0,
    effectiveCount
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
  const avgWinDollars = wins ? winDollars / wins : 0;
  const avgLossDollars = losses ? lossDollars / losses : 0;
  const avgWinR = mean(winRMultiples);
  const avgLossR = mean(lossRMultiples);
  const totalR = sum(rMultiples);
  const avgR = mean(rMultiples);
  const stdDevR = sampleStdDev(rMultiples, avgR);
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

  let currentStreakSign: "Win" | "Loss" | null = null;
  let currentStreakCount = 0;
  let currentStreakDollars = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let bestWinStreakDollars = 0;
  let worstLossStreakDollars = 0;
  for (const trade of exitSortedTrades) {
    const sign = trade.rMultiple > 0 ? "Win" : trade.rMultiple < 0 ? "Loss" : null;
    if (!sign) {
      currentStreakSign = null;
      currentStreakCount = 0;
      currentStreakDollars = 0;
      continue;
    }
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

  return {
    activeDayRatePct: calendarDays ? (activeDays / calendarDays) * 100 : 0,
    avgLossDollars,
    avgWinDollars,
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
    bestR: Math.max(0, ...rMultiples),
    worstR: Math.min(0, ...rMultiples),
    p10R: percentile(rMultiples, 10),
    p25R: percentile(rMultiples, 25),
    p75R: percentile(rMultiples, 75),
    p90R: percentile(rMultiples, 90),
    skewR: skewness(rMultiples),
    excessKurtosisR: excessKurtosis(rMultiples),
    avgDurationMs: mean(durationsMs),
    avgWinDurationMs: mean(winDurationsMs),
    avgLossDurationMs: mean(lossDurationsMs),
    medianDurationMs: median(durationsMs),
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
    shortestGapMs: entryGapsMs.length ? Math.min(...entryGapsMs) : 0,
    longestGapMs: Math.max(0, ...entryGapsMs),
    maxDailyDrawdownDollars: Math.max(0, ...dailyCurve.map((point) => point.drawdown)),
    maxTradeDrawdownDollars,
    maxRunupDollars,
    recoveryFactor: maxTradeDrawdownDollars > 0 ? totalDollars / maxTradeDrawdownDollars : totalDollars > 0 ? Infinity : 0,
    ulcerIndexDollars: Math.sqrt(mean(dailyCurve.map((point) => point.drawdown ** 2))),
    painIndexDollars: mean(dailyCurve.map((point) => point.drawdown)),
    underwaterDaysPct: dailyCurve.length ? (dailyCurve.filter((point) => point.drawdown > 0).length / dailyCurve.length) * 100 : 0,
    equityHighs,
    avgDailyDollars: averageDailyPnl,
    avgActiveDayDollars: mean(activeDailyValues),
    dailyProfitFactor: dailyGrossLossDollars ? dailyGrossWinDollars / dailyGrossLossDollars : dailyGrossWinDollars ? Infinity : 0,
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
    avgDollars: trades.length ? totalDollars / trades.length : 0,
    longestWinStreak,
    longestLossStreak,
    bestWinStreakDollars,
    worstLossStreakDollars,
    currentStreakLabel: currentTailSign ?? "None",
    currentStreakCount: currentTailCount,
    avgAfterWinDollars: mean(afterWinDollars),
    avgAfterLossDollars: mean(afterLossDollars),
    avgWinToTargetPct: mean(
      exitSortedTrades.filter((trade) => trade.rMultiple > 0 && trade.targetDollars > 0).map((trade) => (trade.pnlDollars / trade.targetDollars) * 100)
    ),
    avgLossToRiskPct: mean(
      exitSortedTrades.filter((trade) => trade.rMultiple < 0 && trade.riskDollars > 0).map((trade) => (Math.abs(trade.pnlDollars) / trade.riskDollars) * 100)
    ),
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

function StatGroup({ stats, title }: { stats: StatCardData[]; title: string }) {
  return (
    <section className="selectedStatsGroup" aria-label={title}>
      <h3>{title}</h3>
      <div className="backtest-stats-grid selectedStatsDenseGrid">
        {stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>
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
    const strategy = strategyByKey.get(trade.key);
    if (!strategy) return parsedCustomScaleRange ? customRangeScaleForTrade(trade, parsedCustomScaleRange) : 1;
    const editScale = strategyContractScale(strategy, edits);
    if (strategyHasContractEdit(strategy, edits)) return editScale;
    return parsedCustomScaleRange ? customRangeScaleForTrade(trade, parsedCustomScaleRange) : editScale;
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
    { label: "Max bars held", value: showWhenTrades(stats, fmtNumber(stats.maxBarsHeld)), tone: "tone-neutral" }
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
    segmentTextStat("Common exit", stats.commonExitReason, "share")
  ];

  const calendarStats: StatCardData[] = [
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
    segmentTextStat("Best weekday", stats.weekdays.best, "avg", "tone-up"),
    segmentTextStat("Worst weekday", stats.weekdays.worst, "avg", "tone-down"),
    segmentTextStat("Best entry hour", stats.entryHours.best, "avg", "tone-up"),
    segmentTextStat("Worst entry hour", stats.entryHours.worst, "avg", "tone-down"),
    segmentTextStat("Best month", stats.months.best, "avg", "tone-up"),
    segmentTextStat("Worst month", stats.months.worst, "avg", "tone-down")
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
    { label: "Skew", value: showWhenTrades(stats, fmtNumber(stats.skewR)), tone: statTone(stats.skewR) as StatTone },
    { label: "Excess kurt", value: showWhenTrades(stats, fmtNumber(stats.excessKurtosisR)), tone: stats.excessKurtosisR > 3 ? "tone-down" : "tone-neutral" }
  ];

  const concentrationStats: StatCardData[] = [
    { label: "Models", value: showWhenTrades(stats, fmtCount(stats.strategies.count)), tone: "tone-neutral" },
    { label: "Effective models", value: showWhenTrades(stats, fmtNumber(stats.strategies.effectiveCount)), tone: "tone-neutral" },
    { label: "Top model share", value: showWhenTrades(stats, fmtPct(stats.strategies.largestSharePct)), tone: stats.strategies.largestSharePct > 50 ? "tone-down" : "tone-neutral" },
    segmentTextStat("Best model", stats.strategies.best, "total", "tone-up"),
    segmentTextStat("Worst model", stats.strategies.worst, "total", "tone-down"),
    { label: "Symbols", value: showWhenTrades(stats, fmtCount(stats.symbols.count)), tone: "tone-neutral" },
    { label: "Effective symbols", value: showWhenTrades(stats, fmtNumber(stats.symbols.effectiveCount)), tone: "tone-neutral" },
    { label: "Top symbol share", value: showWhenTrades(stats, fmtPct(stats.symbols.largestSharePct)), tone: stats.symbols.largestSharePct > 50 ? "tone-down" : "tone-neutral" },
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

  const statGroups = [
    { title: "Performance", stats: performanceStats },
    { title: "Risk & Tails", stats: riskStats },
    { title: "Streaks & Momentum", stats: streakStats },
    { title: "Timing & Cadence", stats: timingStats },
    { title: "Trade Shape", stats: tradeShapeStats },
    { title: "Calendar Edge", stats: calendarStats },
    { title: "R-Multiple Anatomy", stats: rStats },
    { title: "Concentration", stats: concentrationStats }
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
      {expanded ? statGroups.map((group) => <StatGroup key={group.title} title={group.title} stats={group.stats} />) : null}
      {toggleable ? (
        <div className="selectedStatsToggleHint" aria-hidden="true">
          <span>{expanded ? "Hide details" : "More stats"}</span>
        </div>
      ) : null}
    </div>
  );
}
