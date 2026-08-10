import { NextRequest, NextResponse } from "next/server";
import { executeAutoTrade, executeAutoTradeManagement, type AutoTradeExecutionResult } from "@/lib/auto-trader";
import { autoTradeMarketForSignal } from "@/lib/auto-trade-platforms";
import { adjustAutoTradeSizeToLimits } from "@/lib/auto-trade-risk";
import { plannedAutoTradeSizeForTrade } from "@/lib/auto-trade-utils";
import { dollarPerUnit, instrumentSizeLabel } from "@/lib/instruments";
import { sendDiscord } from "@/lib/discord";
import { assetTimeframeBarsKey } from "@/lib/market-data-refresh";
import { fetchStoredAssetBars, fetchStoredMarketBars } from "@/lib/market-data-store";
import { saveCronRun, updateDatasetSyncRunStatus } from "@/lib/live-config";
import { activeRules, evaluateRecentSignals } from "@/lib/live-signals";
import { cronWeekendPause, marketOpenForSignal } from "@/lib/market-schedule";
import { claimTrade, getTrades, saveTrade } from "@/lib/storage";
import { sendTradeManagementNotification, sendTradeNotification, sendTradeOutcomeNotification } from "@/lib/notifications";
import { enrichProjectXTradeOutcome } from "@/lib/projectx-auto-trader";
import { DEFAULT_STRATEGY_TIMEFRAME, timeframeFromVariant, type DataTimeframe } from "@/lib/timeframes";
import { TOPSTEP_100K_ACCOUNT, reviewTopstepSignal, withTopstepGuardNote } from "@/lib/topstep";
import { sendTelegram } from "@/lib/telegram";
import type { Bar, CronResult, StrategyRule, TradeAlert, TradeManagementEvent } from "@/lib/types";
import { sendDueDailyTradeSummaries, sendDueWeeklyTradeSummaries } from "@/lib/weekly-trade-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const FIFTEEN_MINUTE_MS = 15 * 60_000;
const DEFAULT_SIGNAL_SCAN_LOOKBACK_HOURS = 26;
const DEFAULT_SIGNAL_MAX_ACTIONABLE_AGE_MINUTES = 75;
const DEFAULT_SIGNAL_SCAN_CONCURRENCY = 6;
const DEFAULT_AUTO_TRADE_DISPATCH_CONCURRENCY = 2;
const DEFAULT_PROJECTX_LIFECYCLE_RESULT_WAIT_HOURS = 24;

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown signal check error";
}

export async function runDueTradeSummaries(): Promise<{ dailySummary: unknown; weeklySummary: unknown }> {
  const [dailySummary, weeklySummary] = await Promise.all([
    sendDueDailyTradeSummaries().catch((error) => ({
      checkedAt: new Date().toISOString(),
      sent: [],
      skipped: [
        {
          market: "forex" as const,
          reason: errorMessage(error)
        },
        {
          market: "futures" as const,
          reason: errorMessage(error)
        }
      ]
    })),
    sendDueWeeklyTradeSummaries().catch((error) => ({
      checkedAt: new Date().toISOString(),
      due: true,
      reason: errorMessage(error),
      sent: [],
      skipped: []
    }))
  ]);

  return { dailySummary, weeklySummary };
}

function isDirectCheckSignalsRequest(request: NextRequest): boolean {
  return request.nextUrl.pathname.endsWith("/api/cron/check-signals");
}

function isMarketDataStaleError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /Stored (?:\S+ )?data for .+ is stale at /.test(message) ||
    /Live data for .+ is stale; latest \S+ bar is /.test(message)
  );
}

function signalDollars(trade: TradeAlert): { targetDollars: number; riskDollars: number } {
  const unitValue = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = plannedAutoTradeSizeForTrade(trade);
  return {
    riskDollars: Math.abs(trade.slUnits * unitValue * sizeMultiplier),
    targetDollars: Math.abs(trade.tpUnits * unitValue * sizeMultiplier)
  };
}

function wholeDollarLabel(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function appendAutoTradeSizeAdjustment(trade: TradeAlert, note: string): TradeAlert {
  return {
    ...trade,
    autoTradeSizeAdjustment: [trade.autoTradeSizeAdjustment, note].filter(Boolean).join(" ")
  };
}

type TradeLifecycleHit = {
  pnlDollars: number;
  price: number;
  rMultiple: number;
  status: "take_profit" | "stop_loss" | "max_bars";
  time: string;
};

const NEW_YORK_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/New_York",
  year: "numeric"
});

function lifecycleLookbackMs(): number {
  const hours = Number(process.env.TELEGRAM_TRADE_UPDATE_LOOKBACK_HOURS ?? 72);
  return (Number.isFinite(hours) && hours > 0 ? hours : 72) * 60 * 60_000;
}

function projectXLifecycleResultWaitMs(): number {
  const hours = Number(process.env.PROJECTX_LIFECYCLE_RESULT_WAIT_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_PROJECTX_LIFECYCLE_RESULT_WAIT_HOURS) * 60 * 60_000;
}

function shouldDeferProjectXLifecycleNotification(trade: TradeAlert): boolean {
  const placedProjectXOrders = (trade.autoTradeOrders ?? []).filter(
    (order) => order.status === "placed" && (Boolean(order.accountConnectionId) || trade.autoTradeProviderId === "projectx")
  );
  if (!placedProjectXOrders.length) return false;
  if (placedProjectXOrders.every((order) => typeof order.netPnlDollars === "number" && Number.isFinite(order.netPnlDollars))) return false;

  const startedAt = Date.parse(trade.autoTradeCheckedAt ?? trade.signalTime);
  if (!Number.isFinite(startedAt)) return true;
  return Date.now() - startedAt < projectXLifecycleResultWaitMs();
}

function repeatSuppressionLookbackMs(): number {
  const hours = Number(process.env.SIGNAL_REPEAT_SUPPRESSION_HOURS ?? 12);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 60 * 60_000;
}

function signalScanLookbackMs(): number {
  const minutes = Number(process.env.SIGNAL_SCAN_LOOKBACK_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60_000;
  const hours = Number(process.env.SIGNAL_SCAN_LOOKBACK_HOURS ?? DEFAULT_SIGNAL_SCAN_LOOKBACK_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SIGNAL_SCAN_LOOKBACK_HOURS) * 60 * 60_000;
}

function signalScanMaxBars(lookbackMs: number): number {
  const bars = Number(process.env.SIGNAL_SCAN_MAX_BARS);
  if (Number.isFinite(bars) && bars > 0) return Math.max(1, Math.trunc(bars));
  return Math.ceil(lookbackMs / FIFTEEN_MINUTE_MS) + 4;
}

function maxActionableSignalAgeMs(): number {
  const minutes = Number(process.env.SIGNAL_MAX_ACTIONABLE_AGE_MINUTES ?? DEFAULT_SIGNAL_MAX_ACTIONABLE_AGE_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_SIGNAL_MAX_ACTIONABLE_AGE_MINUTES) * 60_000;
}

function boundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function signalScanConcurrency(): number {
  return boundedIntegerEnv("SIGNAL_SCAN_CONCURRENCY", DEFAULT_SIGNAL_SCAN_CONCURRENCY, 1, 16);
}

function autoTradeDispatchConcurrency(maxAlerts: number): number {
  const fallback = Math.min(Math.max(1, maxAlerts), DEFAULT_AUTO_TRADE_DISPATCH_CONCURRENCY);
  return boundedIntegerEnv("AUTO_TRADE_DISPATCH_CONCURRENCY", fallback, 1, Math.max(1, maxAlerts));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => runWorker()));
  return results;
}

function repeatSignalKey(trade: Pick<TradeAlert, "logicalStrategyKey" | "side" | "strategy" | "strategyId" | "strategyKey" | "symbol">): string | null {
  const strategyKey = trade.logicalStrategyKey ?? trade.strategyKey ?? trade.strategyId ?? trade.strategy;
  if (!strategyKey || !trade.symbol || !trade.side) return null;
  return [trade.symbol, strategyKey, trade.side].join("\t");
}

function signalTimeMs(signal: Pick<TradeAlert, "signalTime">): number | null {
  const time = Date.parse(signal.signalTime);
  return Number.isFinite(time) ? time : null;
}

function newYorkDate(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? NEW_YORK_DAY_FORMATTER.format(new Date(timestamp)) : null;
}

function recentSameStrategyDay(signal: TradeAlert, trades: TradeAlert[]): TradeAlert | null {
  const signalDay = newYorkDate(signal.signalTime);
  const signalStrategy = signal.logicalStrategyKey ?? signal.strategyKey ?? signal.strategyId ?? signal.strategy;
  if (!signalDay || !signalStrategy) return null;

  for (const trade of trades) {
    if (trade.status !== "alerted") continue;
    const tradeStrategy = trade.logicalStrategyKey ?? trade.strategyKey ?? trade.strategyId ?? trade.strategy;
    if (trade.id === signal.id || trade.symbol !== signal.symbol || tradeStrategy !== signalStrategy) continue;
    if (newYorkDate(trade.signalTime) === signalDay) return trade;
  }

  return null;
}

function dailyStrategyKey(signal: TradeAlert): string | null {
  const signalDay = newYorkDate(signal.signalTime);
  const signalStrategy = signal.logicalStrategyKey ?? signal.strategyKey ?? signal.strategyId ?? signal.strategy;
  return signalDay && signalStrategy && signal.symbol ? [signal.symbol, signalStrategy, signalDay].join("\t") : null;
}

function recentRepeatTrade(signal: TradeAlert, trades: TradeAlert[], lookbackMs: number): TradeAlert | null {
  const key = repeatSignalKey(signal);
  const signalTimestamp = signalTimeMs(signal);
  if (!key || signalTimestamp === null) return null;

  for (const trade of trades) {
    if (trade.id === signal.id || repeatSignalKey(trade) !== key) continue;
    const tradeTimestamp = signalTimeMs(trade);
    if (tradeTimestamp === null) continue;
    if (tradeTimestamp >= signalTimestamp - lookbackMs && tradeTimestamp <= signalTimestamp) {
      return trade;
    }
  }

  return null;
}

function recentCandidateRepeatTrade(
  signal: TradeAlert,
  candidatesByRepeatKey: Map<string, TradeAlert[]>,
  lookbackMs: number
): TradeAlert | null {
  const key = repeatSignalKey(signal);
  const signalTimestamp = signalTimeMs(signal);
  if (!key || signalTimestamp === null) return null;

  for (const trade of candidatesByRepeatKey.get(key) ?? []) {
    const tradeTimestamp = signalTimeMs(trade);
    if (tradeTimestamp === null) continue;
    if (tradeTimestamp >= signalTimestamp - lookbackMs && tradeTimestamp <= signalTimestamp) {
      return trade;
    }
  }

  return null;
}

function addCandidateRepeatTrade(signal: TradeAlert, candidatesByRepeatKey: Map<string, TradeAlert[]>): void {
  const key = repeatSignalKey(signal);
  if (!key) return;
  candidatesByRepeatKey.set(key, [...(candidatesByRepeatKey.get(key) ?? []), signal]);
}

type LifecycleAndManagementEvaluation = {
  hit: TradeLifecycleHit | null;
  managementEvents: TradeManagementEvent[];
};

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function effectivePriceUnit(trade: TradeAlert, rule: StrategyRule | null): number {
  if (rule?.tickSize && rule.tickSize > 0) return rule.tickSize;
  const stopDistance = Math.abs(trade.entryPrice - trade.stopLossPrice);
  if (stopDistance > 0 && trade.slUnits > 0) return stopDistance / trade.slUnits;
  const targetDistance = Math.abs(trade.takeProfitPrice - trade.entryPrice);
  if (targetDistance > 0 && trade.tpUnits > 0) return targetDistance / trade.tpUnits;
  return 1;
}

function roundToPriceUnit(value: number, priceUnit: number): number {
  if (!(priceUnit > 0) || !Number.isFinite(priceUnit)) return value;
  return Number((Math.round(value / priceUnit) * priceUnit).toFixed(10));
}

function priceChanged(left: number, right: number, priceUnit: number): boolean {
  const minimumMove = Math.max(priceUnit * 0.1, 1e-8);
  return Math.abs(left - right) >= minimumMove;
}

function improvesStop(trade: TradeAlert, candidate: number, currentStop: number, priceUnit: number): boolean {
  if (!(candidate > 0) || !priceChanged(candidate, currentStop, priceUnit)) return false;
  return trade.side === "long" ? candidate > currentStop : candidate < currentStop;
}

function improvesTakeProfit(trade: TradeAlert, candidate: number, currentTakeProfit: number, priceUnit: number): boolean {
  if (!(candidate > 0) || !priceChanged(candidate, currentTakeProfit, priceUnit)) return false;
  return trade.side === "long" ? candidate > currentTakeProfit : candidate < currentTakeProfit;
}

function managementEventId(trade: TradeAlert, type: TradeManagementEvent["type"], time: string, price: number): string {
  const parsedTime = Date.parse(time);
  const normalizedTime = Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : time;
  return `${trade.id}:${type}:${normalizedTime}:${price.toFixed(10)}`;
}

function orderedManagementEvents(trade: TradeAlert): TradeManagementEvent[] {
  return [...(trade.managementEvents ?? [])]
    .filter((event) => finiteNumber(event.price))
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

function hasEquivalentManagementEvent(events: TradeManagementEvent[], event: TradeManagementEvent, priceUnit: number): boolean {
  return events.some(
    (current) =>
      current.id === event.id ||
      (current.type === event.type &&
        current.time === event.time &&
        finiteNumber(current.price) &&
        !priceChanged(current.price, event.price, priceUnit))
  );
}

function mergeManagementEvents(existing: TradeManagementEvent[] | undefined, additions: TradeManagementEvent[]): TradeManagementEvent[] {
  const merged = new Map<string, TradeManagementEvent>();
  for (const event of [...(existing ?? []), ...additions]) {
    merged.set(event.id, event);
  }
  return [...merged.values()].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

function trackedBarsAfterSignal(trade: TradeAlert, bars: Bar[]): Bar[] {
  const signalTime = Date.parse(trade.signalTime);
  return bars
    .filter((bar) => {
      const time = Date.parse(bar.time);
      return Number.isFinite(time) && time > signalTime;
    })
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

function tradeStrategyKeys(trade: TradeAlert): Set<string> {
  return new Set(
    [trade.logicalStrategyKey, trade.strategyKey, trade.datasetId, trade.strategyId, trade.strategy]
      .filter((value): value is string => Boolean(value))
  );
}

function matchingRuleForTrade(trade: TradeAlert, rules: StrategyRule[]): StrategyRule | null {
  const keys = tradeStrategyKeys(trade);
  const keyedMatch = rules.find(
    (rule) =>
      keys.has(rule.key) ||
      keys.has(rule.logicalKey) ||
      (rule.datasetId ? keys.has(rule.datasetId) : false) ||
      keys.has(rule.strategyId) ||
      keys.has(rule.label)
  );
  if (keyedMatch) return keyedMatch;

  return (
    rules.find((rule) => rule.assetKey === trade.assetKey && rule.symbol === trade.symbol) ??
    rules.find((rule) => rule.symbol === trade.symbol && rule.market === trade.market) ??
    null
  );
}

function managementSwing(rule: StrategyRule | null): number {
  const raw = rule?.variantId
    ?.split("|")
    .find((token) => token.startsWith("swing="))
    ?.slice("swing=".length);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(2, Math.round(parsed))) : 2;
}

function latestConfirmedHourlyPivot(
  trade: TradeAlert,
  rule: StrategyRule | null,
  hourlyBars: Bar[],
  entryTime: string,
  referenceTime: string,
  kind: "high" | "low"
): number | null {
  const referenceTimeMs = Date.parse(referenceTime);
  const entryTimeMs = Date.parse(entryTime);
  if (!Number.isFinite(referenceTimeMs) || !Number.isFinite(entryTimeMs)) return null;

  const available = hourlyBars
    .filter((bar) => {
      const time = Date.parse(bar.time);
      return Number.isFinite(time) && time <= referenceTimeMs;
    })
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  const swing = managementSwing(rule);
  const hourIndex = available.length - 1;
  const entryHourIndex = available.findLastIndex((bar) => Date.parse(bar.time) <= entryTimeMs);
  const confirmedLimit = hourIndex - swing;
  if (entryHourIndex < 0 || confirmedLimit <= entryHourIndex) return null;

  const isPivot = (index: number): boolean => {
    if (index < swing || index + swing >= available.length) return false;
    const value = available[index]![kind];
    const left = available.slice(index - swing, index).map((bar) => bar[kind]);
    const right = available.slice(index + 1, index + swing + 1).map((bar) => bar[kind]);
    return kind === "high"
      ? left.every((candidate) => value > candidate) && right.every((candidate) => value >= candidate)
      : left.every((candidate) => value < candidate) && right.every((candidate) => value <= candidate);
  };

  for (let index = confirmedLimit; index > entryHourIndex; index -= 1) {
    if (isPivot(index)) return available[index]![kind];
  }
  return null;
}

function stopManagementCandidate(
  trade: TradeAlert,
  rule: StrategyRule | null,
  trackedBars: Bar[],
  hourlyBars: Bar[],
  index: number,
  currentStop: number,
  initialRisk: number,
  priceUnit: number
): { label?: string; price: number; reason: string } | null {
  const policy = rule?.dynamicStopLossPolicy;
  if (!policy) return null;

  const bar = trackedBars[index];
  if (!bar) return null;

  const buffer = (policy.bufferUnits ?? 0) * priceUnit;
  const candidates: Array<{ label?: string; price: number; reason: string }> = [];
  const direction = trade.side === "long" ? 1 : -1;
  const triggerMultiple = Math.max(0.01, policy.triggerMultiple ?? 1);
  const lockMultiple = Math.max(0, Math.min(triggerMultiple - 0.01, policy.lockMultiple ?? 0));
  const favorableTrigger =
    initialRisk > 0 &&
    (trade.side === "long"
      ? bar.high >= trade.entryPrice + initialRisk * triggerMultiple
      : bar.low <= trade.entryPrice - initialRisk * triggerMultiple);

  if (favorableTrigger) {
    const lockedPrice = trade.entryPrice + direction * initialRisk * lockMultiple;
    candidates.push({
      label: lockMultiple > 0 ? `Lock ${lockMultiple}R` : "Break Even",
      price: lockedPrice,
      reason: lockMultiple > 0
        ? `Lock ${lockMultiple}R after price moved at least ${triggerMultiple}R in favor.`
        : `Move SL to Break Even after price moved at least ${triggerMultiple}R in favor.`
    });
  }

  if (policy.mode === "trail_prior_bar") {
    candidates.push({
      price: trade.side === "long" ? bar.low - buffer : bar.high + buffer,
      reason: "Trail SL using the prior completed bar."
    });
  }

  if (policy.mode === "trail_hourly_pivot") {
    const pivot = latestConfirmedHourlyPivot(
      trade,
      rule,
      hourlyBars,
      trackedBars[0]?.time ?? trade.signalTime,
      bar.time,
      trade.side === "long" ? "low" : "high"
    );
    if (pivot !== null) {
      candidates.push({
        price: trade.side === "long" ? pivot - buffer : pivot + buffer,
        reason: "Trail SL using the latest confirmed hourly pivot."
      });
    }
  }

  const improvingCandidates = candidates
    .map((candidate) => ({ ...candidate, price: roundToPriceUnit(candidate.price, priceUnit) }))
    .filter((candidate) => improvesStop(trade, candidate.price, currentStop, priceUnit));
  if (!improvingCandidates.length) return null;

  return improvingCandidates.sort((left, right) => direction * (right.price - left.price))[0] ?? null;
}

function takeProfitManagementCandidate(
  trade: TradeAlert,
  rule: StrategyRule | null,
  trackedBars: Bar[],
  hourlyBars: Bar[],
  index: number,
  currentTakeProfit: number,
  currentStop: number,
  priceUnit: number
): { price: number; reason: string } | null {
  const policy = rule?.dynamicTakeProfitPolicy;
  if (!policy) return null;

  const buffer = (policy.bufferUnits ?? 0) * priceUnit;
  const direction = trade.side === "long" ? 1 : -1;
  const candidates: Array<{ price: number; reason: string }> = [];

  const bar = trackedBars[index];
  if (!bar) return null;

  if (policy.mode === "trail_prior_bar") {
    candidates.push({
      price: trade.side === "long" ? bar.high + buffer : bar.low - buffer,
      reason: "Trail TP using the prior completed bar."
    });
  }

  if (policy.mode === "trail_hourly_extreme") {
    const extreme = latestConfirmedHourlyPivot(
      trade,
      rule,
      hourlyBars,
      trackedBars[0]?.time ?? trade.signalTime,
      bar.time,
      trade.side === "long" ? "high" : "low"
    );
    if (extreme !== null) {
      candidates.push({
        price: trade.side === "long" ? extreme + buffer : extreme - buffer,
        reason: "Trail TP using the latest confirmed hourly extreme."
      });
    }
  }

  if (policy.mode === "risk_multiple" && policy.rewardMultiple && policy.rewardMultiple > 0) {
    const liveRisk = Math.abs(trade.entryPrice - currentStop);
    if (liveRisk > 0) {
      candidates.push({
        price: trade.entryPrice + direction * liveRisk * policy.rewardMultiple,
        reason: `Edit TP to maintain ${policy.rewardMultiple}R against the managed stop.`
      });
    }
  }

  const improvingCandidates = candidates
    .map((candidate) => ({ ...candidate, price: roundToPriceUnit(candidate.price, priceUnit) }))
    .filter((candidate) => improvesTakeProfit(trade, candidate.price, currentTakeProfit, priceUnit));
  if (!improvingCandidates.length) return null;

  return improvingCandidates.sort((left, right) => direction * (right.price - left.price))[0] ?? null;
}

function lifecycleHitAt(
  trade: TradeAlert,
  dollars: { riskDollars: number; targetDollars: number },
  price: number,
  status: TradeLifecycleHit["status"],
  time: string
): TradeLifecycleHit {
  const initialRisk = Math.abs(trade.entryPrice - trade.stopLossPrice);
  const sideMultiplier = trade.side === "long" ? 1 : -1;
  const rMultiple =
    initialRisk > 0
      ? ((price - trade.entryPrice) * sideMultiplier) / initialRisk
      : status === "take_profit"
        ? dollars.targetDollars / Math.max(dollars.riskDollars, 1)
        : -1;

  return {
    pnlDollars: rMultiple * dollars.riskDollars,
    price,
    rMultiple,
    status,
    time
  };
}

function evaluateTradeLifecycleAndManagement(
  trade: TradeAlert,
  bars: Bar[],
  hourlyBars: Bar[],
  rule: StrategyRule | null
): LifecycleAndManagementEvaluation {
  const trackedBars = trackedBarsAfterSignal(trade, bars);
  if (!trackedBars.length) return { hit: null, managementEvents: [] };

  const dollars = signalDollars(trade);
  const maxBars = typeof trade.maxBars === "number" && Number.isFinite(trade.maxBars) && trade.maxBars > 0 ? Math.round(trade.maxBars) : null;
  const initialRisk = Math.abs(trade.entryPrice - trade.stopLossPrice);
  const priceUnit = effectivePriceUnit(trade, rule);
  const knownEvents = orderedManagementEvents(trade);
  const newManagementEvents: TradeManagementEvent[] = [];

  let currentStop = trade.stopLossPrice;
  let currentTakeProfit = trade.takeProfitPrice;
  let knownEventIndex = 0;

  const applyKnownEventsBefore = (timestamp: number) => {
    while (knownEventIndex < knownEvents.length) {
      const event = knownEvents[knownEventIndex]!;
      const eventTime = Date.parse(event.time);
      if (!Number.isFinite(eventTime) || eventTime >= timestamp) break;
      if (event.type === "edit_sl") currentStop = event.price;
      if (event.type === "edit_tp") currentTakeProfit = event.price;
      knownEventIndex += 1;
    }
  };

  const addManagementEvent = (
    type: TradeManagementEvent["type"],
    time: string,
    price: number,
    previousPrice: number | undefined,
    reason: string,
    label?: string,
    plan?: Pick<TradeManagementEvent, "entryPrice" | "stopLossPrice" | "takeProfitPrice">
  ) => {
    const roundedPrice = roundToPriceUnit(price, priceUnit);
    const event: TradeManagementEvent = {
      createdAt: new Date().toISOString(),
      entryPrice: plan?.entryPrice,
      id: managementEventId(trade, type, time, roundedPrice),
      label,
      previousPrice,
      price: roundedPrice,
      reason,
      stopLossPrice: plan?.stopLossPrice,
      takeProfitPrice: plan?.takeProfitPrice,
      time,
      type
    };
    if (!hasEquivalentManagementEvent([...knownEvents, ...newManagementEvents], event, priceUnit)) {
      newManagementEvents.push(event);
    }
  };

  for (const [index, bar] of trackedBars.entries()) {
    const barTime = Date.parse(bar.time);
    if (Number.isFinite(barTime)) applyKnownEventsBefore(barTime);

    const hitTakeProfit = trade.side === "long" ? bar.high >= currentTakeProfit : bar.low <= currentTakeProfit;
    const hitStopLoss = trade.side === "long" ? bar.low <= currentStop : bar.high >= currentStop;

    if (hitTakeProfit || hitStopLoss) {
      const status = hitStopLoss ? "stop_loss" : "take_profit";
      const price = status === "take_profit" ? currentTakeProfit : currentStop;
      return {
        hit: lifecycleHitAt(trade, dollars, price, status, bar.time),
        managementEvents: newManagementEvents
      };
    }

    if (maxBars && index + 1 >= maxBars && initialRisk > 0) {
      return {
        hit: lifecycleHitAt(trade, dollars, bar.close, "max_bars", bar.time),
        managementEvents: newManagementEvents
      };
    }

    const stopCandidate = stopManagementCandidate(trade, rule, trackedBars, hourlyBars, index, currentStop, initialRisk, priceUnit);
    if (stopCandidate) {
      const previousPrice = currentStop;
      currentStop = stopCandidate.price;
      addManagementEvent("edit_sl", bar.time, stopCandidate.price, previousPrice, stopCandidate.reason, stopCandidate.label, {
        entryPrice: trade.entryPrice,
        stopLossPrice: currentStop,
        takeProfitPrice: currentTakeProfit
      });
    }

    const takeProfitCandidate = takeProfitManagementCandidate(
      trade,
      rule,
      trackedBars,
      hourlyBars,
      index,
      currentTakeProfit,
      currentStop,
      priceUnit
    );
    if (takeProfitCandidate) {
      const previousPrice = currentTakeProfit;
      currentTakeProfit = takeProfitCandidate.price;
      addManagementEvent("edit_tp", bar.time, takeProfitCandidate.price, previousPrice, takeProfitCandidate.reason, undefined, {
        entryPrice: trade.entryPrice,
        stopLossPrice: currentStop,
        takeProfitPrice: currentTakeProfit
      });
    }

  }

  return { hit: null, managementEvents: newManagementEvents };
}

async function notifyTradeLifecycles(result: CronResult, barsByAssetKey: Map<string, Bar[]>, rules: StrategyRule[]): Promise<void> {
  const oldestSignalTime = Date.now() - lifecycleLookbackMs();
  const openTrades = (await getTrades()).filter(
    (trade) =>
      trade.status === "alerted" &&
      !trade.lifecycleNotifiedAt &&
      trade.lifecycleStatus !== "take_profit" &&
      trade.lifecycleStatus !== "stop_loss" &&
      trade.lifecycleStatus !== "max_bars" &&
      (Date.parse(trade.signalTime) || 0) >= oldestSignalTime &&
      Boolean(trade.assetKey)
  );
  const lifecycleBarsByAssetKey = new Map<string, Bar[]>();
  const hourlyBarsByAssetKey = new Map<string, Bar[]>();

  for (const trade of openTrades) {
    try {
      const assetKey = trade.assetKey!;
      let bars = lifecycleBarsByAssetKey.get(assetKey);
      if (!bars) {
        bars = await fetchStoredAssetBars(assetKey, 5_000, "1m").catch(async () => {
          const cached = barsByAssetKey.get(assetKey);
          return cached?.length ? cached : fetchStoredAssetBars(assetKey);
        });
        lifecycleBarsByAssetKey.set(assetKey, bars);
      }
      let hourlyBars = hourlyBarsByAssetKey.get(assetKey);
      if (!hourlyBars) {
        hourlyBars = await fetchStoredAssetBars(assetKey, 1_500, "1h").catch(() => []);
        hourlyBarsByAssetKey.set(assetKey, hourlyBars);
      }

      const evaluation = evaluateTradeLifecycleAndManagement(trade, bars, hourlyBars, matchingRuleForTrade(trade, rules));
      const notifiedManagementEvents: TradeManagementEvent[] = [];
      let tradeForManagement = trade;
      for (const event of evaluation.managementEvents) {
        const autoTrade = await executeAutoTradeManagement(tradeForManagement, event).catch(
          (error): AutoTradeExecutionResult => ({
            checkedAt: new Date().toISOString(),
            error: errorMessage(error),
            status: "failed"
          })
        );
        const eventWithAutoTrade: TradeManagementEvent = {
          ...event,
          autoTradeError: autoTrade.error,
          autoTradeOrders: autoTrade.orders,
          autoTradeStatus: autoTrade.status
        };
        const notification = await sendTradeManagementNotification(tradeForManagement, eventWithAutoTrade);
        const savedEvent: TradeManagementEvent = {
          ...eventWithAutoTrade,
          discordError: notification.discord.error,
          discordStatus: notification.discord.status,
          telegramError: notification.telegram.error,
          telegramStatus: notification.telegram.status
        };
        notifiedManagementEvents.push(savedEvent);
        tradeForManagement = {
          ...tradeForManagement,
          managementEvents: mergeManagementEvents(tradeForManagement.managementEvents, [savedEvent])
        };
      }

      const tradeWithManagementEvents: TradeAlert = notifiedManagementEvents.length
        ? {
            ...trade,
            managementEvents: mergeManagementEvents(trade.managementEvents, notifiedManagementEvents)
          }
        : trade;

      if (!evaluation.hit) {
        if (notifiedManagementEvents.length) await saveTrade(tradeWithManagementEvents);
        continue;
      }

      const updatedTrade: TradeAlert = await enrichProjectXTradeOutcome({
        ...tradeWithManagementEvents,
        lifecycleNotifiedAt: new Date().toISOString(),
        lifecyclePnlDollars: evaluation.hit.pnlDollars,
        lifecyclePrice: evaluation.hit.price,
        lifecycleRMultiple: evaluation.hit.rMultiple,
        lifecycleStatus: evaluation.hit.status,
        lifecycleTime: evaluation.hit.time
      });
      if (shouldDeferProjectXLifecycleNotification(updatedTrade)) {
        await saveTrade({
          ...tradeWithManagementEvents,
          autoTradeOrders: updatedTrade.autoTradeOrders
        });
        continue;
      }
      const notification = await sendTradeOutcomeNotification(updatedTrade);
      await saveTrade({
        ...updatedTrade,
        discordLifecycleError: notification.discord.error,
        discordLifecycleStatus: notification.discord.status,
        telegramLifecycleError: notification.telegram.error,
        telegramLifecycleStatus: notification.telegram.status
      });
    } catch (error) {
      result.errors.push({
        symbol: trade.symbol,
        message: `Trade lifecycle check failed: ${errorMessage(error)}`
      });
    }
  }
}

function genericSignalScore(trade: TradeAlert, riskDollars: number, targetDollars: number): number {
  const boundedProfitFactor = Number.isFinite(trade.liveProfitFactor) ? Math.min(Math.max(trade.liveProfitFactor, 0), 6) : 1;
  const rewardRisk = riskDollars > 0 ? targetDollars / riskDollars : 0;
  return trade.estimatedWinRatePct / 50 + Math.log1p(boundedProfitFactor) + Math.min(rewardRisk, 4) * 0.18;
}

function recordAssetTiming(
  timings: Map<string, { assetKey: string; durationMs: number; rules: number; symbol: string }>,
  rule: { assetKey: string; symbol: string },
  durationMs: number,
  rules = 1
): void {
  const current = timings.get(rule.assetKey) ?? {
    assetKey: rule.assetKey,
    durationMs: 0,
    rules: 0,
    symbol: rule.symbol
  };
  current.durationMs += durationMs;
  current.rules += rules;
  timings.set(rule.assetKey, current);
}

function tradeWithAutoTradeResult(trade: TradeAlert, autoTrade: AutoTradeExecutionResult): TradeAlert {
  return {
    ...trade,
    autoTradeAccountId: autoTrade.accountId,
    autoTradeAccountName: autoTrade.accountName,
    autoTradeCheckedAt: autoTrade.checkedAt,
    autoTradeContractId: autoTrade.contractId,
    autoTradeContractName: autoTrade.contractName,
    autoTradeCustomTag: autoTrade.customTag,
    autoTradeError: autoTrade.error,
    autoTradeOrderId: autoTrade.orderId,
    autoTradeOrders: autoTrade.orders,
    autoTradeProviderId: autoTrade.providerId,
    autoTradeProviderName: autoTrade.providerName,
    autoTradeStatus: autoTrade.status
  };
}

type SignalScanGroup = {
  assetKey: string;
  rules: Array<{ index: number; rule: StrategyRule }>;
  symbol: string;
  timeframe: DataTimeframe;
};

export type RunSignalCheckOptions = {
  initialBarsByTimeframeKey?: Map<string, Bar[]>;
};

type ScannedSignal = {
  order: number;
  rule: StrategyRule;
  signal: TradeAlert;
};

type SignalScanGroupResult = {
  assetKey: string;
  bars?: Bar[];
  durationMs: number;
  errors: Array<{ message: string; symbol: string }>;
  rawSignals: number;
  rules: number;
  signals: ScannedSignal[];
  skippedData: Array<{ assetKey: string; reason: string; symbol: string }>;
  symbol: string;
  timeframe: DataTimeframe;
};

function signalScanGroups(rules: StrategyRule[]): SignalScanGroup[] {
  const groups = new Map<string, SignalScanGroup>();
  rules.forEach((rule, index) => {
    const timeframe = timeframeFromVariant(rule.variantId, DEFAULT_STRATEGY_TIMEFRAME);
    const key = `${rule.assetKey}\t${timeframe}`;
    const group = groups.get(key) ?? {
      assetKey: rule.assetKey,
      rules: [],
      symbol: rule.symbol,
      timeframe
    };
    group.rules.push({ index, rule });
    groups.set(key, group);
  });
  return [...groups.values()];
}

async function scanSignalGroup(
  group: SignalScanGroup,
  scanMaxBars: number,
  scanSinceMs: number,
  options: RunSignalCheckOptions = {}
): Promise<SignalScanGroupResult> {
  const startedAt = Date.now();
  const baseResult: SignalScanGroupResult = {
    assetKey: group.assetKey,
    durationMs: 0,
    errors: [],
    rawSignals: 0,
    rules: group.rules.length,
    signals: [],
    skippedData: [],
    symbol: group.symbol,
    timeframe: group.timeframe
  };

  try {
    const prefetchedBars = options.initialBarsByTimeframeKey?.get(assetTimeframeBarsKey(group.assetKey, group.timeframe));
    const bars = prefetchedBars && prefetchedBars.length >= 260 ? prefetchedBars : await fetchStoredMarketBars(group.rules[0]!.rule);
    for (const { index, rule } of group.rules) {
      const signals = evaluateRecentSignals(rule, bars, { maxBars: scanMaxBars, sinceMs: scanSinceMs });
      baseResult.rawSignals += signals.length;
      signals.forEach((signal, signalIndex) => {
        baseResult.signals.push({
          order: index * 1_000_000 + signalIndex,
          rule,
          signal
        });
      });
    }
    return {
      ...baseResult,
      bars: group.timeframe === DEFAULT_STRATEGY_TIMEFRAME ? bars : undefined,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    if (isMarketDataStaleError(error)) {
      return {
        ...baseResult,
        durationMs: Date.now() - startedAt,
        skippedData: [
          {
            assetKey: group.assetKey,
            reason: errorMessage(error),
            symbol: group.symbol
          }
        ]
      };
    }

    return {
      ...baseResult,
      durationMs: Date.now() - startedAt,
      errors: [
        {
          symbol: group.symbol,
          message: error instanceof Error ? error.message : "Unknown error"
        }
      ]
    };
  }
}

type DispatchOutcome = {
  skippedDuplicate?: string;
  trade?: TradeAlert;
};

function isQueuedTradeClaim(trade: TradeAlert): boolean {
  return trade.autoTradeStatus === "skipped" && trade.autoTradeError?.includes("execution queued") === true;
}

async function recoverRecentNotificationFailures(
  trades: TradeAlert[],
  actionableAgeMs: number,
  result: CronResult
): Promise<void> {
  const now = Date.now();
  const recoverable = trades.filter((trade) => {
    const signalAt = signalTimeMs(trade);
    if (signalAt === null || now - signalAt > actionableAgeMs) return false;
    return isQueuedTradeClaim(trade) || trade.telegramStatus === "failed" || trade.discordStatus === "failed";
  });

  for (const trade of recoverable) {
    try {
      const queued = isQueuedTradeClaim(trade);
      const recoveryTrade: TradeAlert = queued
        ? {
            ...trade,
            autoTradeCheckedAt: new Date().toISOString(),
            autoTradeError: "Alert recovered after an interrupted dispatch; automatic execution outcome is unknown and was not retried.",
            autoTradeStatus: "skipped"
          }
        : trade;
      const [telegram, discord] = await Promise.all([
        queued || trade.telegramStatus === "failed" ? sendTelegram(recoveryTrade) : Promise.resolve(null),
        queued || trade.discordStatus === "failed" ? sendDiscord(recoveryTrade) : Promise.resolve(null)
      ]);

      await saveTrade({
        ...recoveryTrade,
        discordError: discord?.error ?? recoveryTrade.discordError,
        discordStatus: discord?.status ?? recoveryTrade.discordStatus,
        telegramError: telegram?.error ?? recoveryTrade.telegramError,
        telegramStatus: telegram?.status ?? recoveryTrade.telegramStatus
      });
    } catch (error) {
      result.errors.push({
        message: `Notification recovery failed: ${errorMessage(error)}`,
        symbol: trade.symbol
      });
    }
  }
}

type SignalCandidate = {
  autoTradeBlockedReason?: string;
  riskDollars: number;
  score: number;
  signal: TradeAlert;
};

async function dispatchSelectedSignal(candidate: SignalCandidate): Promise<DispatchOutcome> {
  const claimed = await claimTrade({
    ...candidate.signal,
    autoTradeCheckedAt: new Date().toISOString(),
    autoTradeError: "Auto-trade execution queued; awaiting connector dispatch.",
    autoTradeStatus: "skipped"
  });
  if (!claimed) {
    return { skippedDuplicate: candidate.signal.id };
  }

  let autoTrade: AutoTradeExecutionResult;
  if (candidate.autoTradeBlockedReason) {
    autoTrade = {
      checkedAt: new Date().toISOString(),
      error: `Alert only; auto-trade blocked by execution guard: ${candidate.autoTradeBlockedReason}`,
      status: "skipped"
    };
  } else {
    try {
      autoTrade = await executeAutoTrade(candidate.signal);
    } catch (error) {
      autoTrade = {
        checkedAt: new Date().toISOString(),
        error: `Alert only; automatic execution failed unexpectedly: ${errorMessage(error)}`,
        status: "failed"
      };
    }
  }
  const executableSignal = tradeWithAutoTradeResult(candidate.signal, autoTrade);
  const [notification] = await Promise.all([sendTradeNotification(executableSignal), saveTrade(executableSignal)]);
  const trade: TradeAlert = {
    ...executableSignal,
    discordError: notification.discord.error,
    discordStatus: notification.discord.status,
    telegramError: notification.telegram.error,
    telegramStatus: notification.telegram.status
  };

  await saveTrade(trade);
  return { trade };
}

export async function runSignalCheck(options: RunSignalCheckOptions = {}): Promise<CronResult> {
  const result: CronResult = {
    checkedAt: new Date().toISOString(),
    generated: [],
    skippedData: [],
    skippedDuplicates: [],
    skippedRisk: [],
    errors: []
  };
  const candidates: SignalCandidate[] = [];
  const recentTrades = await getTrades();
  const repeatLookbackMs = repeatSuppressionLookbackMs();
  const scanReferenceMs = Date.now();
  const scanLookbackMs = signalScanLookbackMs();
  const scanMaxBars = signalScanMaxBars(scanLookbackMs);
  const scanConcurrency = signalScanConcurrency();
  const maxActionableAgeMs = maxActionableSignalAgeMs();
  await recoverRecentNotificationFailures(recentTrades, maxActionableAgeMs, result);
  const scanSinceMs = scanReferenceMs - scanLookbackMs;
  const candidateRepeatSignals = new Map<string, TradeAlert[]>();
  const candidateDailyKeys = new Set<string>();
  const allRules = await activeRules();
  const existingTradeIds = new Set(recentTrades.map((trade) => trade.id));
  if (!allRules.length) {
    throw new Error("No active live strategies are enabled for signal checks.");
  }
  const sessionReference = new Date(scanReferenceMs);
  const rules = allRules.filter((rule) => marketOpenForSignal(rule.market, sessionReference, { assetKey: rule.assetKey, symbol: rule.symbol })?.open ?? false);
  result.signalScan = {
    candidates: 0,
    lookbackMinutes: Math.round(scanLookbackMs / 60_000),
    maxActionableAgeMinutes: Math.round(maxActionableAgeMs / 60_000),
    maxBars: scanMaxBars,
    rawSignals: 0,
    scanConcurrency,
    staleSignals: 0
  };
  if (!rules.length) {
    result.skippedData?.push({
      assetKey: "market-session",
      reason: "No configured forex or futures market is open for signal checks.",
      symbol: "ALL"
    });
    return result;
  }

  const barsByAssetKey = new Map<string, Bar[]>();
  const assetTimings = new Map<string, { assetKey: string; durationMs: number; rules: number; symbol: string }>();
  const skippedDataKeys = new Set<string>();

  const groupResults = await mapWithConcurrency(signalScanGroups(rules), scanConcurrency, (group) =>
    scanSignalGroup(group, scanMaxBars, scanSinceMs, options)
  );
  const scannedSignals: ScannedSignal[] = [];

  for (const groupResult of groupResults) {
    recordAssetTiming(assetTimings, groupResult, groupResult.durationMs, groupResult.rules);
    if (groupResult.bars) barsByAssetKey.set(groupResult.assetKey, groupResult.bars);
    result.signalScan.rawSignals += groupResult.rawSignals;
    scannedSignals.push(...groupResult.signals);

    for (const skippedData of groupResult.skippedData) {
      if (skippedDataKeys.has(skippedData.assetKey)) continue;
      skippedDataKeys.add(skippedData.assetKey);
      result.skippedData?.push(skippedData);
    }

    for (const error of groupResult.errors) {
      result.errors.push(error);
    }
  }

  scannedSignals.sort((left, right) => left.order - right.order);

  for (const { rule, signal } of scannedSignals) {
    if (existingTradeIds.has(signal.id)) {
      result.skippedDuplicates.push(signal.id);
      continue;
    }

    const signalTimestamp = signalTimeMs(signal);
    if (signalTimestamp === null || scanReferenceMs - signalTimestamp > maxActionableAgeMs) {
      result.signalScan.staleSignals += 1;
      result.skippedRisk.push({
        id: signal.id,
        symbol: signal.symbol,
        reason: `missed signal is older than the ${result.signalScan.maxActionableAgeMinutes} minute actionable window`
      });
      continue;
    }

    if (rule.oneTradePerDay) {
      const sameDayTrade = recentSameStrategyDay(signal, recentTrades);
      if (sameDayTrade) {
        result.skippedDuplicates.push(`${signal.id} repeats ${sameDayTrade.id} on the same New York session`);
        continue;
      }
      const dayKey = dailyStrategyKey(signal);
      if (dayKey && candidateDailyKeys.has(dayKey)) {
        result.skippedDuplicates.push(`${signal.id} repeats another same-session signal in this check`);
        continue;
      }
      if (dayKey) candidateDailyKeys.add(dayKey);
    }

    const repeat = recentRepeatTrade(signal, recentTrades, repeatLookbackMs);
    if (repeat) {
      result.skippedDuplicates.push(`${signal.id} repeats ${repeat.id}`);
      continue;
    }

    const candidateRepeat = recentCandidateRepeatTrade(signal, candidateRepeatSignals, repeatLookbackMs);
    if (candidateRepeat) {
      result.skippedDuplicates.push(`${signal.id} repeats another signal in this check (${candidateRepeat.id})`);
      continue;
    }
    addCandidateRepeatTrade(signal, candidateRepeatSignals);

    const signalMarket = autoTradeMarketForSignal(signal.market);
    if (!signalMarket) {
      result.skippedRisk.push({
        id: signal.id,
        symbol: signal.symbol,
        reason: `no auto-trade market route for ${signal.market}`
      });
      continue;
    }

    const topstepReview = signalMarket === "futures" ? reviewTopstepSignal(rule, signal) : null;
    if (topstepReview && !topstepReview.allowed) {
      const reason = topstepReview.reason ?? "Futures risk guard rejected automatic execution";
      candidates.push({
        autoTradeBlockedReason: reason,
        riskDollars: 0,
        score: topstepReview.score,
        signal: {
          ...signal,
          notes: [signal.notes, `Alert only: automatic futures execution blocked because ${reason}.`].filter(Boolean).join(" ")
        }
      });
      result.signalScan.candidates = candidates.length;
      continue;
    }

    const dollars = topstepReview ?? signalDollars(signal);
    candidates.push({
      signal: topstepReview ? withTopstepGuardNote(signal, topstepReview) : signal,
      score: topstepReview?.score ?? genericSignalScore(signal, dollars.riskDollars, dollars.targetDollars),
      riskDollars: dollars.riskDollars
    });
    result.signalScan.candidates = candidates.length;
  }

  result.assetTimings = [...assetTimings.values()];

  const configuredMaxAlerts = Number(process.env.AUTO_TRADE_MAX_ALERTS_PER_CHECK ?? process.env.TOPSTEP_MAX_ALERTS_PER_CHECK ?? TOPSTEP_100K_ACCOUNT.maxAlertsPerCheck);
  const configuredMaxRisk = Number(process.env.AUTO_TRADE_MAX_RISK_PER_CHECK ?? process.env.TOPSTEP_MAX_RISK_PER_CHECK ?? TOPSTEP_100K_ACCOUNT.maxRiskPerCheck);
  const maxAlerts = Number.isFinite(configuredMaxAlerts) && configuredMaxAlerts > 0 ? configuredMaxAlerts : TOPSTEP_100K_ACCOUNT.maxAlertsPerCheck;
  const maxRisk = Number.isFinite(configuredMaxRisk) && configuredMaxRisk > 0 ? configuredMaxRisk : TOPSTEP_100K_ACCOUNT.maxRiskPerCheck;
  let acceptedRisk = 0;
  let processedExecutableCandidates = 0;

  const rankedCandidates = candidates
    .sort((left, right) => right.score - left.score || (signalTimeMs(right.signal) ?? 0) - (signalTimeMs(left.signal) ?? 0));
  const executableCandidateCount = rankedCandidates.filter((candidate) => !candidate.autoTradeBlockedReason).length;
  const selected = rankedCandidates
    .map((candidate): SignalCandidate => {
      if (candidate.autoTradeBlockedReason) return candidate;
      processedExecutableCandidates += 1;
      const remainingRisk = Math.max(0, maxRisk - acceptedRisk);
      const remainingCandidates = Math.max(1, executableCandidateCount - processedExecutableCandidates + 1);
      const fairRiskCapacity = remainingRisk / remainingCandidates;
      if (candidate.riskDollars > fairRiskCapacity + 0.01) {
        const adjustment = adjustAutoTradeSizeToLimits(candidate.signal, { maxRiskDollars: fairRiskCapacity });
        if (adjustment.size > 0 && adjustment.riskDollars <= fairRiskCapacity + 0.01) {
          const note = `Risk guard reduced units from ${instrumentSizeLabel(candidate.signal.symbol, adjustment.originalSize)} to ${instrumentSizeLabel(candidate.signal.symbol, adjustment.size)} so every concurrent signal can share the ${wholeDollarLabel(maxRisk)} per-check risk budget.`;
          acceptedRisk += adjustment.riskDollars;
          return {
            ...candidate,
            riskDollars: adjustment.riskDollars,
            signal: appendAutoTradeSizeAdjustment(adjustment.trade, note)
          };
        }

        const reason = `no executable minimum unit remains within this signal's ${wholeDollarLabel(fairRiskCapacity)} share of the ${wholeDollarLabel(maxRisk)} per-check risk budget`;
        result.skippedRisk.push({
          id: candidate.signal.id,
          symbol: candidate.signal.symbol,
          reason
        });
        return { ...candidate, autoTradeBlockedReason: reason, riskDollars: 0 };
      }
      acceptedRisk += candidate.riskDollars;
      return candidate;
    });

  // AUTO_TRADE_MAX_ALERTS_PER_CHECK now limits broker dispatch concurrency only;
  // every risk-safe signal remains eligible for execution.
  result.signalScan.dispatchConcurrency = autoTradeDispatchConcurrency(maxAlerts);
  const dispatchOutcomes = await mapWithConcurrency(selected, result.signalScan.dispatchConcurrency, dispatchSelectedSignal);
  for (const outcome of dispatchOutcomes) {
    if (outcome.skippedDuplicate) {
      result.skippedDuplicates.push(outcome.skippedDuplicate);
      continue;
    }
    if (outcome.trade) result.generated.push(outcome.trade);
  }

  await notifyTradeLifecycles(result, barsByAssetKey, rules);

  return result;
}

export async function GET(request: NextRequest) {
  const auth = isAuthorized(request);
  if (auth === "missing-secret") {
    return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500 });
  }
  if (auth === "bad-secret") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get("health") === "1") {
    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      ok: true,
      route: "/api/cron/check-signals"
    });
  }
  const directCheckSignalsRequest = isDirectCheckSignalsRequest(request);
  const weekendPause = cronWeekendPause();
  if (weekendPause.paused) {
    const summaries = directCheckSignalsRequest ? await runDueTradeSummaries() : {};
    return NextResponse.json({
      ok: true,
      route: "/api/cron/check-signals",
      skipped: true,
      ...summaries,
      weekendPause,
    });
  }
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  await updateDatasetSyncRunStatus("signalTradeCheck", {
    error: undefined,
    finishedAt: undefined,
    startedAt: startedAtIso,
    state: "running"
  }).catch((error) => console.error("Failed to mark signal check running", error));

  try {
    const result = await runSignalCheck();
    await saveCronRun(result);
    const durationMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();
    const failed = result.errors.length > 0;

    await updateDatasetSyncRunStatus("signalTradeCheck", {
      durationMs,
      error: failed ? result.errors.map((entry) => `${entry.symbol}: ${entry.message}`).join("; ") : undefined,
      finishedAt,
      startedAt: startedAtIso,
      state: failed ? "failed" : "success"
    }).catch((error) => console.error("Failed to mark signal check finished", error));

    console.info("check-signals cron completed", {
      assetTimings: result.assetTimings,
      durationMs,
      errors: result.errors.length,
      generated: result.generated.length,
      signalScan: result.signalScan,
      skippedData: result.skippedData?.length ?? 0,
      skippedDuplicates: result.skippedDuplicates.length,
      skippedRisk: result.skippedRisk.length
    });
    if (directCheckSignalsRequest) await runDueTradeSummaries();
    return NextResponse.json(result);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = errorMessage(error);
    await updateDatasetSyncRunStatus("signalTradeCheck", {
      durationMs,
      error: message,
      finishedAt: new Date().toISOString(),
      startedAt: startedAtIso,
      state: "failed"
    }).catch((statusError) => console.error("Failed to mark signal check failed", statusError));
    console.error("check-signals cron failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
