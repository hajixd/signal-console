import { NextRequest, NextResponse } from "next/server";
import { executeAutoTrade, type AutoTradeExecutionResult } from "@/lib/auto-trader";
import { autoTradeMarketForSignal } from "@/lib/auto-trade-platforms";
import { dollarPerUnit } from "@/lib/instruments";
import { fetchStoredAssetBars, fetchStoredMarketBars } from "@/lib/market-data-store";
import { saveCronRun, updateDatasetSyncRunStatus } from "@/lib/live-config";
import { activeRules, evaluateLatestSignal } from "@/lib/live-signals";
import { claimTrade, getTrades, hasTrade, saveTrade } from "@/lib/storage";
import { sendTelegram, sendTelegramManagement, sendTelegramOutcome } from "@/lib/telegram";
import { TOPSTEP_100K_ACCOUNT, reviewTopstepSignal, withTopstepGuardNote } from "@/lib/topstep";
import type { Bar, CronResult, StrategyRule, TradeAlert, TradeManagementEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown signal check error";
}

function isMarketDataStaleError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /Stored data for .+ is stale at /.test(message) ||
    /Live data for .+ is stale; latest 15m bar is /.test(message)
  );
}

function signalDollars(trade: TradeAlert): { targetDollars: number; riskDollars: number } {
  const unitValue = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = trade.sizeMultiplier ?? 1;
  return {
    riskDollars: Math.abs(trade.slUnits * unitValue * sizeMultiplier),
    targetDollars: Math.abs(trade.tpUnits * unitValue * sizeMultiplier)
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

function repeatSuppressionLookbackMs(): number {
  const hours = Number(process.env.SIGNAL_REPEAT_SUPPRESSION_HOURS ?? 12);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 60 * 60_000;
}

function repeatSignalKey(trade: Pick<TradeAlert, "logicalStrategyKey" | "side" | "strategy" | "strategyId" | "strategyKey" | "symbol">): string | null {
  const strategyKey = trade.logicalStrategyKey ?? trade.strategyKey ?? trade.strategyId ?? trade.strategy;
  if (!strategyKey || !trade.symbol || !trade.side) return null;
  return [trade.symbol, strategyKey, trade.side].join("\t");
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
  const signalTimeMs = Date.parse(signal.signalTime);
  if (!key || !Number.isFinite(signalTimeMs)) return null;

  for (const trade of trades) {
    if (trade.id === signal.id || repeatSignalKey(trade) !== key) continue;
    const tradeTimeMs = Date.parse(trade.signalTime);
    if (!Number.isFinite(tradeTimeMs)) continue;
    if (tradeTimeMs >= signalTimeMs - lookbackMs && tradeTimeMs <= signalTimeMs) {
      return trade;
    }
  }

  return null;
}

type LifecycleAndManagementEvaluation = {
  hit: TradeLifecycleHit | null;
  managementEvents: TradeManagementEvent[];
};

const MANAGEMENT_AUTO_TRADE_NOTE =
  "ProjectX order modification is not configured in this app yet; this management event was logged and sent as a notification.";

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

function stopManagementCandidate(
  trade: TradeAlert,
  rule: StrategyRule | null,
  trackedBars: Bar[],
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
  const favorableOneR =
    initialRisk > 0 &&
    (trade.side === "long"
      ? bar.high >= trade.entryPrice + initialRisk
      : bar.low <= trade.entryPrice - initialRisk);

  if (favorableOneR) {
    candidates.push({
      label: "Break Even",
      price: trade.entryPrice,
      reason: "Move SL to Break Even after price moved at least 1R in favor."
    });
  }

  if (policy.mode === "trail_prior_bar" && index > 0) {
    const priorBar = trackedBars[index - 1]!;
    candidates.push({
      price: trade.side === "long" ? priorBar.low - buffer : priorBar.high + buffer,
      reason: "Trail SL using the prior completed bar."
    });
  }

  if (policy.mode === "trail_hourly_pivot" && index > 0) {
    const lookbackBars = trackedBars.slice(Math.max(0, index - 4), index);
    if (lookbackBars.length >= 2) {
      const pivot = trade.side === "long"
        ? Math.min(...lookbackBars.map((lookbackBar) => lookbackBar.low)) - buffer
        : Math.max(...lookbackBars.map((lookbackBar) => lookbackBar.high)) + buffer;
      candidates.push({
        price: pivot,
        reason: "Trail SL using the latest hourly pivot window."
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

  if (policy.mode === "trail_prior_bar" && index > 0) {
    const priorBar = trackedBars[index - 1]!;
    candidates.push({
      price: trade.side === "long" ? priorBar.high + buffer : priorBar.low - buffer,
      reason: "Trail TP using the prior completed bar."
    });
  }

  if (policy.mode === "trail_hourly_extreme" && index > 0) {
    const lookbackBars = trackedBars.slice(Math.max(0, index - 4), index);
    if (lookbackBars.length >= 2) {
      const extreme = trade.side === "long"
        ? Math.max(...lookbackBars.map((lookbackBar) => lookbackBar.high)) + buffer
        : Math.min(...lookbackBars.map((lookbackBar) => lookbackBar.low)) - buffer;
      candidates.push({
        price: extreme,
        reason: "Trail TP using the latest hourly extreme window."
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
      autoTradeError: MANAGEMENT_AUTO_TRADE_NOTE,
      autoTradeStatus: "skipped",
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

    const stopCandidate = stopManagementCandidate(trade, rule, trackedBars, index, currentStop, initialRisk, priceUnit);
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

  for (const trade of openTrades) {
    try {
      const assetKey = trade.assetKey!;
      let bars = barsByAssetKey.get(assetKey);
      if (!bars) {
        bars = await fetchStoredAssetBars(assetKey);
        barsByAssetKey.set(assetKey, bars);
      }

      const evaluation = evaluateTradeLifecycleAndManagement(trade, bars, matchingRuleForTrade(trade, rules));
      const notifiedManagementEvents: TradeManagementEvent[] = [];
      for (const event of evaluation.managementEvents) {
        const notification = await sendTelegramManagement(trade, event);
        notifiedManagementEvents.push({
          ...event,
          telegramError: notification.error,
          telegramStatus: notification.status
        });
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

      const updatedTrade: TradeAlert = {
        ...tradeWithManagementEvents,
        lifecycleNotifiedAt: new Date().toISOString(),
        lifecyclePnlDollars: evaluation.hit.pnlDollars,
        lifecyclePrice: evaluation.hit.price,
        lifecycleRMultiple: evaluation.hit.rMultiple,
        lifecycleStatus: evaluation.hit.status,
        lifecycleTime: evaluation.hit.time
      };
      const notification = await sendTelegramOutcome(updatedTrade);
      await saveTrade({
        ...updatedTrade,
        telegramLifecycleError: notification.error,
        telegramLifecycleStatus: notification.status
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
  durationMs: number
): void {
  const current = timings.get(rule.assetKey) ?? {
    assetKey: rule.assetKey,
    durationMs: 0,
    rules: 0,
    symbol: rule.symbol
  };
  current.durationMs += durationMs;
  current.rules += 1;
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

async function runSignalCheck(): Promise<CronResult> {
  const result: CronResult = {
    checkedAt: new Date().toISOString(),
    generated: [],
    skippedData: [],
    skippedDuplicates: [],
    skippedRisk: [],
    errors: []
  };
  const candidates: Array<{ signal: ReturnType<typeof withTopstepGuardNote>; score: number; riskDollars: number }> = [];
  const recentTrades = await getTrades();
  const repeatLookbackMs = repeatSuppressionLookbackMs();
  const candidateRepeatKeys = new Set<string>();
  const candidateDailyKeys = new Set<string>();
  const rules = await activeRules();
  if (!rules.length) {
    throw new Error("No active live strategies are enabled for signal checks.");
  }

  const barsByAssetKey = new Map<string, Bar[]>();
  const assetTimings = new Map<string, { assetKey: string; durationMs: number; rules: number; symbol: string }>();
  const skippedDataKeys = new Set<string>();

  for (const rule of rules) {
    const ruleStartedAt = Date.now();
    try {
      let bars = barsByAssetKey.get(rule.assetKey);
      if (!bars) {
        bars = await fetchStoredMarketBars(rule);
        barsByAssetKey.set(rule.assetKey, bars);
      }
      const signal = evaluateLatestSignal(rule, bars);
      if (!signal) continue;

      if (await hasTrade(signal.id)) {
        result.skippedDuplicates.push(signal.id);
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

      const candidateRepeatKey = repeatSignalKey(signal);
      if (candidateRepeatKey && candidateRepeatKeys.has(candidateRepeatKey)) {
        result.skippedDuplicates.push(`${signal.id} repeats another signal in this check`);
        continue;
      }
      if (candidateRepeatKey) {
        candidateRepeatKeys.add(candidateRepeatKey);
      }

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
        result.skippedRisk.push({
          id: signal.id,
          symbol: signal.symbol,
          reason: topstepReview.reason ?? "Futures risk guard rejected the signal"
        });
        continue;
      }

      const dollars = topstepReview ?? signalDollars(signal);
      candidates.push({
        signal: topstepReview ? withTopstepGuardNote(signal, topstepReview) : signal,
        score: topstepReview?.score ?? genericSignalScore(signal, dollars.riskDollars, dollars.targetDollars),
        riskDollars: dollars.riskDollars
      });
    } catch (error) {
      if (isMarketDataStaleError(error)) {
        if (!skippedDataKeys.has(rule.assetKey)) {
          skippedDataKeys.add(rule.assetKey);
          result.skippedData?.push({
            assetKey: rule.assetKey,
            reason: errorMessage(error),
            symbol: rule.symbol
          });
        }
        continue;
      }
      result.errors.push({
        symbol: rule.symbol,
        message: error instanceof Error ? error.message : "Unknown error"
      });
    } finally {
      recordAssetTiming(assetTimings, rule, Date.now() - ruleStartedAt);
    }
  }

  result.assetTimings = [...assetTimings.values()];

  const configuredMaxAlerts = Number(process.env.AUTO_TRADE_MAX_ALERTS_PER_CHECK ?? process.env.TOPSTEP_MAX_ALERTS_PER_CHECK ?? TOPSTEP_100K_ACCOUNT.maxAlertsPerCheck);
  const configuredMaxRisk = Number(process.env.AUTO_TRADE_MAX_RISK_PER_CHECK ?? process.env.TOPSTEP_MAX_RISK_PER_CHECK ?? TOPSTEP_100K_ACCOUNT.maxRiskPerCheck);
  const maxAlerts = Number.isFinite(configuredMaxAlerts) && configuredMaxAlerts > 0 ? configuredMaxAlerts : TOPSTEP_100K_ACCOUNT.maxAlertsPerCheck;
  const maxRisk = Number.isFinite(configuredMaxRisk) && configuredMaxRisk > 0 ? configuredMaxRisk : TOPSTEP_100K_ACCOUNT.maxRiskPerCheck;
  let acceptedRisk = 0;
  let acceptedCount = 0;

  const selected = candidates
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => {
      if (acceptedCount >= maxAlerts) {
        result.skippedRisk.push({
          id: candidate.signal.id,
          symbol: candidate.signal.symbol,
          reason: `lower-ranked concurrent signal; ${maxAlerts} alert limit for this check`
        });
        return false;
      }
      if (acceptedRisk + candidate.riskDollars > maxRisk) {
        result.skippedRisk.push({
          id: candidate.signal.id,
          symbol: candidate.signal.symbol,
          reason: `would exceed ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(maxRisk)} risk budget for this check`
        });
        return false;
      }
      acceptedRisk += candidate.riskDollars;
      acceptedCount += 1;
      return true;
    });

  for (const candidate of selected) {
    const claimed = await claimTrade({
      ...candidate.signal,
      autoTradeCheckedAt: new Date().toISOString(),
      autoTradeError: "Auto-trade execution queued; awaiting connector dispatch.",
      autoTradeStatus: "skipped"
    });
    if (!claimed) {
      result.skippedDuplicates.push(candidate.signal.id);
      continue;
    }
    const autoTrade = await executeAutoTrade(candidate.signal);
    const executableSignal = tradeWithAutoTradeResult(candidate.signal, autoTrade);
    await saveTrade(executableSignal);
    const notification = await sendTelegram(executableSignal);
    const trade: TradeAlert = {
      ...executableSignal,
      telegramStatus: notification.status,
      telegramError: notification.error
    };

    await saveTrade(trade);
    result.generated.push(trade);
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
      skippedData: result.skippedData?.length ?? 0,
      skippedDuplicates: result.skippedDuplicates.length,
      skippedRisk: result.skippedRisk.length
    });
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
