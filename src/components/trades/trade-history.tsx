"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { createPortal } from "react-dom";
import { useAutoTradeAdminMode } from "@/components/auto-trading/use-auto-trade-account-mode";
import TradePriceChart, { TRADE_CHART_TIMEFRAMES, type TradeChartBar, type TradeChartTimeframe } from "@/components/trades/trade-price-chart";
import LocalDateTime from "@/components/ui/local-date-time";
import { focusedPriceDomain, priceAxisFractionDigits } from "@/lib/chart-scale";
import {
  buildManagedLevelStepPath,
  buildOpenTradeChartPoints,
  latestOpenTradeMark,
  mergeLiveOpenTradeBar,
  resolveOpenTradePathRange
} from "@/lib/open-trade-chart";
import { oneMinuteBarsHeld, resolveFirstTradeBracketHit } from "@/lib/trade-bracket-truth";
import type { TradeManagementEvent } from "@/lib/types";

export type TradeHistoryRow = {
  id: string;
  strategyKey: string;
  rowClassName: string;
  pnlClassName: string;
  pnlDollars: number;
  indexLabel: string;
  symbol: string;
  displaySymbol?: string;
  modelName: string;
  marketLabel: string;
  market?: string;
  side: "long" | "short";
  sideLabel: string;
  sideClassName: string;
  entryIndex: number;
  exitIndex: number;
  signalTime: string;
  entryTime: string;
  exitTime: string;
  sourceTimeframe?: TradeChartTimeframe;
  strategyTimeframe?: TradeChartTimeframe;
  phase?: string;
  variantId?: string;
  entryType?: "market" | "limit";
  entryPrice: number;
  exitPrice: number;
  targetPrice: number;
  stopPrice: number;
  managementEvents?: TradeManagementEvent[];
  signalTimeLabel: string;
  entryTimeLabel: string;
  exitTimeLabel: string;
  entryPriceLabel: string;
  exitPriceLabel: string;
  targetPriceLabel: string;
  stopPriceLabel: string;
  durationLabel: string;
  durationDetailLabel: string;
  exitReasonLabel: string;
  pnlLabel: string;
  rMultipleLabel: string;
  netUnitsLabel: string;
  sizeLabel: string;
  sizeMultiplier: number;
  targetRiskLabel: string;
  targetLabel: string;
  riskLabel: string;
  targetDollars: number;
  riskDollars: number;
  dollarsPerPricePoint: number;
  tpUnitsLabel: string;
  slUnitsLabel: string;
  lockedSize?: boolean;
  isOpen?: boolean;
  hasCurrentMark?: boolean;
  chartPathAvailable?: boolean;
  isEstimatedPnl?: boolean;
  markTime?: string;
};

type TradeHistoryProps = {
  rows: TradeHistoryRow[];
};

type ChartBar = TradeChartBar;

type ChartState = {
  status: "idle" | "loading" | "ready" | "error";
  bars: ChartBar[];
  replayBars?: ChartBar[];
  replayTimeframe?: TradeChartTimeframe;
  sourceBars?: ChartBar[];
  fallback?: boolean;
  message?: string;
  requestedTimeframe?: TradeChartTimeframe;
  timeframe?: TradeChartTimeframe;
};

type ChartPayload = {
  bars?: ChartBar[];
  replayBars?: ChartBar[];
  replayTimeframe?: TradeChartTimeframe;
  error?: string;
  fallback?: boolean;
  requestedTimeframe?: TradeChartTimeframe;
  timeframe?: TradeChartTimeframe;
};

type ProjectXLiveQuotePayload = {
  bar?: Omit<ChartBar, "index"> & { index?: number };
};

type CandleMenuState = {
  clientX: number;
  clientY: number;
  candle: ChartBar;
};

const TRADE_CHART_CONTEXT_CANDLES = 240;
const TRADE_CHART_CACHE_TTL_MS = 2 * 60_000;
const OPEN_TRADE_CHART_REFRESH_MS = 30_000;
const PROJECTX_LIVE_QUOTE_REFRESH_MS = 4_000;
const MAX_TRADE_CHART_CACHE_ENTRIES = 48;
const tradeChartCache = new Map<string, { expiresAt: number; payload: ChartPayload }>();

async function fetchCachedTradeChart(url: string, signal: AbortSignal): Promise<ChartPayload> {
  const cached = tradeChartCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  if (cached) tradeChartCache.delete(url);

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Chart unavailable");
  const payload = (await response.json()) as ChartPayload;
  if (!payload.bars?.length) return payload;

  tradeChartCache.set(url, { expiresAt: Date.now() + TRADE_CHART_CACHE_TTL_MS, payload });
  while (tradeChartCache.size > MAX_TRADE_CHART_CACHE_ENTRIES) {
    const oldestKey = tradeChartCache.keys().next().value;
    if (!oldestKey) break;
    tradeChartCache.delete(oldestKey);
  }
  return payload;
}

async function fetchTradeChart(url: string, signal: AbortSignal, isOpen: boolean): Promise<ChartPayload> {
  if (!isOpen) return fetchCachedTradeChart(url, signal);
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Chart unavailable");
  return (await response.json()) as ChartPayload;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatChartPrice(value: number | null | undefined, fractionDigits?: number): string {
  if (value == null || !Number.isFinite(value)) return "--";
  if (fractionDigits !== undefined) {
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    });
  }
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: Math.abs(value) >= 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 10 ? 5 : 2
  });
}

function formatSignedMoney(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  })}`;
}

function formatLossMoney(value: number): string {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) < 0.005) return "$0";
  return `-$${Math.abs(value).toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  })}`;
}

function timeLabel(value: string | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function axisTimeLabel(value: string | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function nearestPositionForAnchor(bars: ChartBar[], indexValue: number, timeValue?: string): number | null {
  if (!bars.length) return null;
  const targetTime = timeValue ? Date.parse(timeValue) : NaN;
  if (Number.isFinite(targetTime)) {
    let bestPosition = 0;
    let bestDistance = Infinity;

    for (let position = 0; position < bars.length; position += 1) {
      const barTime = Date.parse(bars[position]!.time);
      if (!Number.isFinite(barTime)) continue;
      const distance = Math.abs(barTime - targetTime);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPosition = position;
      }
    }

    if (Number.isFinite(bestDistance)) return bestPosition;
  }

  if (!Number.isFinite(indexValue)) return null;
  let bestPosition = 0;
  let bestDistance = Infinity;

  for (let position = 0; position < bars.length; position += 1) {
    const distance = Math.abs(bars[position]!.index - indexValue);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPosition = position;
    }
  }

  return bestPosition;
}

export function resolvedTradePathRange(
  trade: TradeHistoryRow,
  bars: ChartBar[]
): {
  barsHeld: number;
  boundary: "stop" | "target" | null;
  end: number;
  entryTime: string;
  exitPrice: number;
  exitTime: string;
  start: number;
} | null {
  const entryPosition = nearestPositionForAnchor(bars, trade.entryIndex, trade.entryTime);
  if (entryPosition == null || !bars.length) return null;

  const isStillOpen = trade.isOpen ?? trade.exitReasonLabel.trim().toLowerCase().includes("still open");
  if (isStillOpen) {
    const openRange = resolveOpenTradePathRange(trade, bars);
    if (!openRange) return null;
    return {
      ...openRange,
      barsHeld: oneMinuteBarsHeld(openRange.entryTime, openRange.exitTime, openRange.end - openRange.start + 1)
    };
  }

  const exitPosition = nearestPositionForAnchor(bars, trade.exitIndex, trade.exitTime);
  if (exitPosition == null) return null;

  const fallbackEnd = Math.max(entryPosition, exitPosition);
  const bracketHit = resolveFirstTradeBracketHit(
    {
      entryIndex: bars[entryPosition]!.index,
      entryPrice: trade.entryPrice,
      entryTime: bars[entryPosition]!.time,
      exitIndex: bars[fallbackEnd]!.index,
      exitTime: bars[fallbackEnd]!.time,
      managementEvents: trade.managementEvents,
      side: trade.side,
      stopPrice: trade.stopPrice,
      targetPrice: trade.targetPrice
    },
    bars
  );
  const end = bracketHit?.position ?? fallbackEnd;
  return {
    barsHeld: bracketHit?.barsHeld ?? oneMinuteBarsHeld(bars[entryPosition]!.time, bars[end]!.time, end - entryPosition + 1),
    boundary: bracketHit?.boundary ?? null,
    end,
    entryTime: bars[entryPosition]!.time,
    exitPrice: bracketHit?.exitPrice ?? trade.exitPrice,
    exitTime: bars[end]!.time,
    start: entryPosition
  };
}

function tradePathStats(trade: TradeHistoryRow, bars: ChartBar[]): { mfe: number | null; mae: number | null } {
  const range = resolvedTradePathRange(trade, bars);
  if (!range) return { mfe: null, mae: null };

  const direction = trade.side === "long" ? 1 : -1;
  const dollarsPerPoint = Math.max(0, trade.dollarsPerPricePoint || 0);
  let maxFavorable = 0;
  let maxAdverse = 0;

  for (let position = range.start; position <= range.end; position += 1) {
    const bar = bars[position];
    if (!bar) continue;
    const favorablePrice = direction === 1 ? bar.high : bar.low;
    const adversePrice = direction === 1 ? bar.low : bar.high;
    const favorable = Math.max(0, (favorablePrice - trade.entryPrice) * direction * dollarsPerPoint);
    const adverse = Math.max(0, -((adversePrice - trade.entryPrice) * direction * dollarsPerPoint));
    maxFavorable = Math.max(maxFavorable, favorable);
    maxAdverse = Math.max(maxAdverse, adverse);
  }

  const targetCap = Math.abs(trade.targetDollars);
  const riskCap = Math.abs(trade.riskDollars);

  return {
    mfe: Number.isFinite(maxFavorable) ? (targetCap > 0 ? Math.min(maxFavorable, targetCap) : maxFavorable) : null,
    mae: Number.isFinite(maxAdverse) ? (riskCap > 0 ? Math.min(maxAdverse, riskCap) : maxAdverse) : null
  };
}

function tradePathDurationLabel(trade: TradeHistoryRow, bars: ChartBar[]): string {
  const range = resolvedTradePathRange(trade, bars);
  if (!range) return `${trade.durationLabel} / ${trade.durationDetailLabel}`;
  const entryMs = Date.parse(range.entryTime);
  const exitMs = Date.parse(range.exitTime);
  const elapsedLabel = !Number.isFinite(entryMs) || !Number.isFinite(exitMs) || exitMs <= entryMs
    ? "<1m"
    : formatMinutesCompact((exitMs - entryMs) / 60_000);
  return `${range.barsHeld} ${range.barsHeld === 1 ? "bar" : "bars"} / ${elapsedLabel}`;
}

function InfoBox({
  label,
  value,
  tone = "neutral",
  valueClassName
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "green" | "red" | "blue" | "amber";
  valueClassName?: string;
}) {
  return (
    <div className={`tradeInfoBox tone-${tone}`}>
      <strong className="tradeInfoLabel">{label}</strong>
      <strong className={`tradeInfoValue${valueClassName ? ` ${valueClassName}` : ""}`}>{value || "N/A"}</strong>
    </div>
  );
}

function exitReasonClassName(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("manual win")) return "exitReasonBadge exitTakeProfit";
  if (normalized.includes("manual loss")) return "exitReasonBadge exitStopLoss";
  if (normalized.includes("manual flat")) return "exitReasonBadge exitOther";
  if (normalized.includes("take profit")) return "exitReasonBadge exitTakeProfit";
  if (normalized.includes("stop loss")) return "exitReasonBadge exitStopLoss";
  if (normalized.includes("still open")) return "exitReasonBadge exitOpen";
  if (normalized.includes("max")) return "exitReasonBadge exitMaxBars";
  if (normalized.includes("signal")) return "exitReasonBadge exitSignal";
  if (normalized.includes("time")) return "exitReasonBadge exitTime";
  return "exitReasonBadge exitOther";
}

function displayExitReasonLabel(trade: TradeHistoryRow): string {
  const normalized = trade.exitReasonLabel.trim().toLowerCase();
  if (normalized === "time exit" || normalized === "timed exit" || normalized === "window end") {
    if (trade.pnlDollars > 0) return "Manual Win";
    if (trade.pnlDollars < 0) return "Manual Loss";
    return "Manual Flat";
  }
  return trade.exitReasonLabel;
}

function displaySymbol(trade: TradeHistoryRow): string {
  return trade.displaySymbol?.trim() || trade.symbol;
}

type CalendarActivity = {
  count: number;
  pnl: number;
  wins: number;
  items: TradeHistoryRow[];
};

type CalendarChartState = {
  status: "idle" | "loading" | "ready" | "error";
  bars: ChartBar[];
  message?: string;
};

type MiniChartPoint = {
  high: number;
  low: number;
  price: number;
  relCand: number;
  timeMs: number;
  x: number;
};

type ManagedTradeLevels = {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
};

type MiniLevelSegment = {
  label?: string;
  tone: "tp" | "sl" | "entry" | "limit";
  value: number;
  x1: number;
  x2: number;
  y: number;
};

type MiniLevelConnector = {
  tone: "tp" | "sl";
  x: number;
  y1: number;
  y2: number;
};

type MiniManagementMarker = {
  label: string;
  tone: "tp" | "sl" | "limit";
  x: number;
  y: number;
};

const CALENDAR_DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const PACIFIC_DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric"
});

function pacificDateKey(value: string | Date | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  const parts = PACIFIC_DATE_KEY_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function pacificMonthKey(value: string | Date | undefined): string {
  const key = pacificDateKey(value);
  return key ? key.slice(0, 7) : pacificDateKey(new Date()).slice(0, 7);
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map((value) => Number(value));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return pacificMonthKey(new Date());
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map((value) => Number(value));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  return new Date(Date.UTC(year, month - 1, 15, 12)).toLocaleString(undefined, {
    month: "long",
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric"
  });
}

function calendarDateLabel(dateKey: string): string {
  if (!dateKey) return "Select a day";
  return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric"
  });
}

function weekdayLabel(dateKey: string): string {
  if (!dateKey) return "";
  return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString(undefined, {
    timeZone: PACIFIC_TIME_ZONE,
    weekday: "short"
  });
}

function buildCalendarGrid(monthKey: string, activityByDay: Map<string, CalendarActivity>) {
  const [year, month] = monthKey.split("-").map((value) => Number(value));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [];
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const offset = monthStart.getUTCDay();
  const gridStart = new Date(Date.UTC(year, month - 1, 1 - offset));

  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(gridStart.getTime() + index * 86_400_000);
    const dateKey = current.toISOString().slice(0, 10);
    return {
      activity: activityByDay.get(dateKey) ?? null,
      dateKey,
      day: current.getUTCDate(),
      inMonth: current.getUTCMonth() === monthStart.getUTCMonth()
    };
  });
}

function formatMinutesCompact(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function tradeDurationMinutes(trade: TradeHistoryRow): number {
  const entry = Date.parse(trade.entryTime);
  const exit = Date.parse(trade.exitTime);
  if (Number.isFinite(entry) && Number.isFinite(exit) && exit > entry) return Math.max(1, (exit - entry) / 60_000);
  return 0;
}

function formatCalendarDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value || "-";
  return date.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    month: "short",
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric"
  });
}

function sessionLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Sydney";
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  if (hour >= 16 || hour < 1) return "Tokyo";
  if (hour >= 12 && hour < 21) return "Sydney";
  if (hour >= 0 && hour < 9) return "London";
  if (hour >= 5 && hour < 14) return "New York";
  return "Sydney";
}

function eventPrice(event: TradeManagementEvent, type: TradeManagementEvent["type"]): number | null {
  const value =
    type === "edit_sl"
      ? event.stopLossPrice ?? event.price
      : type === "edit_tp"
        ? event.takeProfitPrice ?? event.price
        : event.entryPrice ?? event.price;
  return Number.isFinite(value) ? value : null;
}

function orderedManagementEvents(trade: TradeHistoryRow): TradeManagementEvent[] {
  return [...(trade.managementEvents ?? [])]
    .filter((event) => Number.isFinite(event.price) && Number.isFinite(Date.parse(event.time)))
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

function managedTradeLevelsAt(trade: TradeHistoryRow, timeMs: number): ManagedTradeLevels {
  const levels: ManagedTradeLevels = {
    entryPrice: trade.entryPrice,
    stopPrice: trade.stopPrice,
    targetPrice: trade.targetPrice
  };

  for (const event of orderedManagementEvents(trade)) {
    const eventMs = Date.parse(event.time);
    if (!Number.isFinite(eventMs) || eventMs > timeMs) break;
    if (event.type === "edit_sl") levels.stopPrice = eventPrice(event, "edit_sl") ?? levels.stopPrice;
    if (event.type === "edit_tp") levels.targetPrice = eventPrice(event, "edit_tp") ?? levels.targetPrice;
    if (event.type === "edit_limit") levels.entryPrice = eventPrice(event, "edit_limit") ?? levels.entryPrice;
  }

  return levels;
}

function managedLevelPrices(trade: TradeHistoryRow, throughTimeMs = Number.POSITIVE_INFINITY): number[] {
  const prices = [trade.entryPrice, trade.exitPrice, trade.targetPrice, trade.stopPrice];
  for (const event of orderedManagementEvents(trade)) {
    if (Date.parse(event.time) > throughTimeMs) break;
    const value = eventPrice(event, event.type);
    if (value != null) prices.push(value);
  }
  return prices.filter((value) => Number.isFinite(value));
}

function managementMarkerLabel(event: TradeManagementEvent): string {
  if (event.label) return event.label;
  if (event.type === "edit_sl") return "SL";
  if (event.type === "edit_tp") return "TP";
  return "Limit";
}

export function buildMiniChartPoints(trade: TradeHistoryRow, bars: ChartBar[]): MiniChartPoint[] {
  if (trade.isOpen) return buildOpenTradeChartPoints(trade, bars);
  const resolvedRange = resolvedTradePathRange(trade, bars);
  const entryMs = Date.parse(trade.entryTime);
  const exitMs = Date.parse(resolvedRange?.exitTime ?? trade.exitTime);
  const resolvedExitPrice = resolvedRange?.exitPrice ?? trade.exitPrice;
  const safeEntryMs = Number.isFinite(entryMs) ? entryMs : Date.now();
  const safeExitMs = Number.isFinite(exitMs) && exitMs > safeEntryMs ? exitMs : safeEntryMs + 60_000;
  const durationMinutes = Math.max(1, Math.ceil((safeExitMs - safeEntryMs) / 60_000));
  const entryPosition = nearestPositionForAnchor(bars, trade.entryIndex, trade.entryTime);
  const exitPosition = nearestPositionForAnchor(bars, trade.exitIndex, trade.exitTime);

  if (entryPosition == null || exitPosition == null || !bars.length) {
    if (trade.isOpen) return [];
    return [
      {
        high: trade.entryPrice,
        low: trade.entryPrice,
        price: trade.entryPrice,
        relCand: -1,
        timeMs: safeEntryMs,
        x: 0
      },
      {
        high: Math.max(trade.entryPrice, resolvedExitPrice),
        low: Math.min(trade.entryPrice, resolvedExitPrice),
        price: resolvedExitPrice,
        relCand: 0,
        timeMs: safeExitMs,
        x: durationMinutes
      }
    ];
  }

  const start = resolvedRange?.start ?? Math.min(entryPosition, exitPosition);
  const end = resolvedRange?.end ?? Math.max(entryPosition, exitPosition);
  const rows: MiniChartPoint[] = [
    {
      high: trade.entryPrice,
      low: trade.entryPrice,
      price: trade.entryPrice,
      relCand: -1,
      timeMs: safeEntryMs,
      x: 0
    }
  ];

  let previousPrice = trade.entryPrice;
  for (let index = start; index <= end; index += 1) {
    const bar = bars[index];
    if (!bar) continue;
    const timeMs = Date.parse(bar.time);
    const minuteIndex = Number.isFinite(timeMs) ? Math.max(1, Math.ceil((timeMs - safeEntryMs) / 60_000)) : rows.length;
    const close = Number.isFinite(bar.close) ? bar.close : previousPrice;
    let high = Number.isFinite(bar.high) ? bar.high : close;
    let low = Number.isFinite(bar.low) ? bar.low : close;
    if (resolvedRange?.boundary && index === end) {
      if (resolvedRange.boundary === "target") {
        if (trade.side === "long") high = Math.min(high, resolvedExitPrice);
        else low = Math.max(low, resolvedExitPrice);
      } else if (trade.side === "long") {
        low = Math.max(low, resolvedExitPrice);
      } else {
        high = Math.min(high, resolvedExitPrice);
      }
    }
    rows.push({
      high,
      low,
      price: close,
      relCand: index - start,
      timeMs: Number.isFinite(timeMs) ? timeMs : safeEntryMs + minuteIndex * 60_000,
      x: minuteIndex
    });
    previousPrice = close;
  }

  const last = rows[rows.length - 1];
  if (!last || last.x < durationMinutes) {
    rows.push({
      high: Math.max(last?.price ?? trade.entryPrice, resolvedExitPrice),
      low: Math.min(last?.price ?? trade.entryPrice, resolvedExitPrice),
      price: resolvedExitPrice,
      relCand: Math.max(0, rows.length - 1),
      timeMs: safeExitMs,
      x: durationMinutes
    });
  } else {
    last.price = resolvedExitPrice;
    last.high = Math.max(last.high, resolvedExitPrice);
    last.low = Math.min(last.low, resolvedExitPrice);
    last.timeMs = safeExitMs;
  }

  return rows.length >= 2 ? rows : [];
}

export function withOpenTradeChartMark(trade: TradeHistoryRow, bars: ChartBar[]): TradeHistoryRow {
  if (!trade.isOpen || !bars.length) return trade;
  const mark = latestOpenTradeMark(trade, bars);
  if (!mark) return trade;
  const pnlDollars = mark.pnlDollars;
  const riskDollars = Math.max(0, Math.abs(trade.riskDollars));
  const exitPriceLabel = `${trade.exitPriceLabel.trim().startsWith("$") ? "$" : ""}${formatChartPrice(mark.exitPrice)}`;
  return {
    ...trade,
    chartPathAvailable: true,
    exitPrice: mark.exitPrice,
    exitPriceLabel,
    exitTime: mark.exitTime,
    exitTimeLabel: timeLabel(mark.exitTime),
    hasCurrentMark: true,
    isEstimatedPnl: true,
    markTime: mark.exitTime,
    pnlClassName: "live-pnl",
    pnlDollars,
    pnlLabel: formatSignedMoney(pnlDollars),
    rMultipleLabel: riskDollars > 0 ? `${(pnlDollars / riskDollars).toFixed(2)}R` : "--"
  };
}

export function BacktestTradeMiniChart({
  bars,
  compactTooltip = false,
  isOpen,
  status,
  trade
}: {
  bars: ChartBar[];
  compactTooltip?: boolean;
  isOpen: boolean;
  status: CalendarChartState["status"];
  trade: TradeHistoryRow;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(820);
  const chartId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const chartRef = useRef<HTMLDivElement | null>(null);
  const data = useMemo(() => buildMiniChartPoints(trade, bars), [bars, trade]);
  const direction = trade.side === "long" ? 1 : -1;
  const dollarsPerPoint = Math.max(0.000001, Math.abs(trade.dollarsPerPricePoint || 1));
  const entryPrice = trade.entryPrice;
  const isStillOpen = trade.isOpen ?? trade.exitReasonLabel.trim().toLowerCase().includes("still open");

  useEffect(() => {
    const node = chartRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;

    const syncWidth = () => setChartWidth(Math.max(360, Math.round(node.getBoundingClientRect().width || 820)));
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const plot = useMemo(() => {
    if (data.length < 2) return null;
    const width = Math.max(360, chartWidth);
    const compactMobile = compactTooltip && width < 640;
    const height = compactMobile ? 194 : width < 640 ? 250 : 300;
    const margins = compactMobile
      ? { top: 14, right: 12, bottom: 14, left: 12 }
      : width < 640
        ? { top: 22, right: 16, bottom: 42, left: 58 }
        : { top: 24, right: 34, bottom: 46, left: 76 };
    const plotWidth = width - margins.left - margins.right;
    const plotHeight = height - margins.top - margins.bottom;
    const chartEndMs = data[data.length - 1]?.timeMs ?? Number.POSITIVE_INFINITY;
    const managedPrices = managedLevelPrices(trade, chartEndMs);
    const priceDomain = focusedPriceDomain(
      [...managedPrices, ...data.flatMap((point) => [point.low, point.price, point.high])],
      trade.entryPrice
    );
    const yMin = priceDomain.min;
    const yMax = priceDomain.max;
    const yAxisFractionDigits = priceAxisFractionDigits(priceDomain, trade.entryPrice);
    const xMax = Math.max(1, ...data.map((point) => point.x));
    const scaleX = (value: number) => margins.left + (value / xMax) * plotWidth;
    const scaleY = (value: number) => margins.top + ((yMax - value) / Math.max(0.000000001, yMax - yMin)) * plotHeight;
    let runningMfe = 0;
    let runningMae = 0;
    const points = data.map((point) => {
      const pricePnl = (point.price - entryPrice) * direction * dollarsPerPoint;
      const favorablePrice = direction === 1 ? point.high : point.low;
      const adversePrice = direction === 1 ? point.low : point.high;
      const favorablePnl = Math.max(0, (favorablePrice - entryPrice) * direction * dollarsPerPoint, pricePnl);
      const adversePnl = Math.min(0, (adversePrice - entryPrice) * direction * dollarsPerPoint, pricePnl);
      runningMfe = Math.max(runningMfe, favorablePnl);
      runningMae = Math.min(runningMae, adversePnl);
      return {
        ...point,
        adversePnl,
        adversePrice,
        favorablePrice,
        favorablePnl,
        pnlDollars: pricePnl,
        runningMae,
        runningMfe,
        xCoord: scaleX(point.x),
        yCoord: scaleY(point.price)
      };
    });
    const toneForPrice = (price: number): "up" | "down" | "flat" => {
      const pnl = (price - entryPrice) * direction * dollarsPerPoint;
      if (pnl > 0.000001) return "up";
      if (pnl < -0.000001) return "down";
      return "flat";
    };
    const segments: Array<{ d: string; tone: "up" | "down" | "flat" }> = [];

    for (let index = 1; index < data.length; index += 1) {
      const previous = data[index - 1]!;
      const current = data[index]!;
      const previousTone = toneForPrice(previous.price);
      const currentTone = toneForPrice(current.price);
      const pushSegment = (leftX: number, leftPrice: number, rightX: number, rightPrice: number, tone: "up" | "down" | "flat") => {
        segments.push({
          d: `M ${scaleX(leftX).toFixed(2)} ${scaleY(leftPrice).toFixed(2)} L ${scaleX(rightX).toFixed(2)} ${scaleY(rightPrice).toFixed(2)}`,
          tone
        });
      };

      const signFlip = (previousTone === "up" && currentTone === "down") || (previousTone === "down" && currentTone === "up");
      if (signFlip && Math.abs(current.price - previous.price) > 0.000000001) {
        const ratio = (entryPrice - previous.price) / (current.price - previous.price);
        if (ratio > 0 && ratio < 1) {
          const crossX = previous.x + (current.x - previous.x) * ratio;
          pushSegment(previous.x, previous.price, crossX, entryPrice, previousTone);
          pushSegment(crossX, entryPrice, current.x, current.price, currentTone);
          continue;
        }
      }

      pushSegment(previous.x, previous.price, current.x, current.price, currentTone === "flat" ? previousTone : currentTone);
    }

    const linePath = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.xCoord.toFixed(2)} ${point.yCoord.toFixed(2)}`)
      .join(" ");
    const entryY = scaleY(trade.entryPrice);
    const areaPath = `${linePath} L ${points[points.length - 1]!.xCoord.toFixed(2)} ${entryY.toFixed(2)} L ${points[0]!.xCoord.toFixed(2)} ${entryY.toFixed(2)} Z`;
    const gridTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => yMax - (yMax - yMin) * ratio);
    const eventX = (time: string) => {
      const eventMs = Date.parse(time);
      if (!Number.isFinite(eventMs)) return null;
      const entryMs = Date.parse(trade.entryTime);
      const safeEntryMs = Number.isFinite(entryMs) ? entryMs : data[0]?.timeMs ?? eventMs;
      return clamp((eventMs - safeEntryMs) / 60_000, 0, xMax);
    };
    const buildManagedSegments = (type: "edit_tp" | "edit_sl", initialValue: number, tone: "tp" | "sl") => {
      const segments: MiniLevelSegment[] = [];
      const connectors: MiniLevelConnector[] = [];
      const markers: MiniManagementMarker[] = [];
      const levelPoints = [{ value: initialValue, x: 0 }];
      let currentValue = initialValue;
      let currentX = 0;
      for (const event of orderedManagementEvents(trade).filter(
        (candidate) => candidate.type === type && Date.parse(candidate.time) <= chartEndMs
      )) {
        const nextValue = eventPrice(event, type);
        const x = eventX(event.time);
        if (nextValue == null || x == null) continue;
        if (x > currentX) {
          segments.push({ tone, value: currentValue, x1: scaleX(currentX), x2: scaleX(x), y: scaleY(currentValue) });
        }
        levelPoints.push({ value: nextValue, x });
        connectors.push({ tone, x: scaleX(x), y1: scaleY(currentValue), y2: scaleY(nextValue) });
        markers.push({ label: managementMarkerLabel(event), tone, x: scaleX(x), y: scaleY(nextValue) });
        currentValue = nextValue;
        currentX = x;
      }
      segments.push({ label: type === "edit_tp" ? "TP" : "SL", tone, value: currentValue, x1: scaleX(currentX), x2: scaleX(xMax), y: scaleY(currentValue) });
      return {
        connectors,
        markers,
        path: buildManagedLevelStepPath(levelPoints, xMax, scaleX, scaleY),
        segments,
        tone
      };
    };
    const targetLevel = buildManagedSegments("edit_tp", trade.targetPrice, "tp");
    const stopLevel = buildManagedSegments("edit_sl", trade.stopPrice, "sl");
    const levelSegments = [...targetLevel.segments, ...stopLevel.segments];
    const levelConnectors = [...targetLevel.connectors, ...stopLevel.connectors];
    const managedLevelPaths = [targetLevel, stopLevel].map((level) => ({ d: level.path, tone: level.tone }));
    const managementMarkers = [...targetLevel.markers, ...stopLevel.markers];
    const entryLevel: MiniLevelSegment = {
      label: trade.entryType === "limit" ? "Limit Entry" : "Entry",
      tone: "entry",
      value: trade.entryPrice,
      x1: scaleX(0),
      x2: scaleX(xMax),
      y: scaleY(trade.entryPrice)
    };
    const limitEntryLine: MiniLevelSegment | null =
      trade.entryType === "limit"
        ? {
            label: "Limit",
            tone: "limit",
            value: trade.entryPrice,
            x1: scaleX(0),
            x2: scaleX(Math.max(1, Math.min(xMax, xMax * 0.18))),
            y: scaleY(trade.entryPrice)
          }
        : null;
    const xTicks = [
      { label: "Entry", value: 0 },
      { label: formatMinutesCompact(xMax / 2), value: xMax / 2 },
      { label: isStillOpen ? "Mark" : "Exit", value: xMax }
    ];
    const mfeIndex = points.reduce((bestIndex, point, index) => (point.favorablePnl > (points[bestIndex]?.favorablePnl ?? -Infinity) ? index : bestIndex), 0);
    const maeIndex = points.reduce((bestIndex, point, index) => (point.adversePnl < (points[bestIndex]?.adversePnl ?? Infinity) ? index : bestIndex), 0);

    return {
      areaPath,
      entryY,
      gridTicks,
      height,
      entryLevel,
      levelConnectors,
      levelSegments,
      managedLevelPaths,
      limitEntryLine,
      linePath,
      maeIndex,
      margins,
      managementMarkers,
      mfeIndex,
      plotHeight,
      plotWidth,
      points,
      segments,
      scaleX,
      scaleY,
      width,
      yAxisFractionDigits,
      xMax,
      xTicks
    };
  }, [
    chartWidth,
    compactTooltip,
    data,
    direction,
    dollarsPerPoint,
    entryPrice,
    isStillOpen,
    trade.entryPrice,
    trade.entryTime,
    trade.entryType,
    trade.exitPrice,
    trade.managementEvents,
    trade.stopPrice,
    trade.targetPrice
  ]);

  if (status === "loading") {
    return <div className="backtest-trade-mini-empty">Loading price movement...</div>;
  }

  if (status === "error" || !plot) {
    return <div className="backtest-trade-mini-empty">Price movement unavailable.</div>;
  }

  const chart = plot;
  const activeIndex = hoverIndex ?? chart.points.length - 1;
  const activePoint = chart.points[activeIndex] ?? chart.points[chart.points.length - 1]!;
  const activeX = activePoint.xCoord;
  const activeY = activePoint.yCoord;
  const tooltipSide = activeX > chart.width * 0.68 ? "left" : "right";
  const tooltipTop = clamp(activeY, 44, chart.height - 52);
  const tooltipTopRatio = tooltipTop / chart.height;
  const activeLevels = managedTradeLevelsAt(trade, activePoint.timeMs);
  const targetGapDollars = (activeLevels.targetPrice - activePoint.price) * direction * dollarsPerPoint;
  const stopBufferDollars = (activePoint.price - activeLevels.stopPrice) * direction * dollarsPerPoint;
  const isTradeWinner = trade.pnlDollars >= 0;
  const chartTone = isStillOpen ? "neutral" : isTradeWinner ? "up" : "down";
  const activePnlTone = activePoint.pnlDollars > 0 ? "up" : activePoint.pnlDollars < 0 ? "down" : "neutral";

  function handleMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const svgX = ratio * chart.width;
    const targetX = clamp((svgX - chart.margins.left) / Math.max(1, chart.plotWidth), 0, 1) * chart.xMax;
    let nextIndex = 0;
    let nextDistance = Infinity;
    for (let index = 0; index < chart.points.length; index += 1) {
      const distance = Math.abs(chart.points[index]!.x - targetX);
      if (distance < nextDistance) {
        nextDistance = distance;
        nextIndex = index;
      }
    }
    setHoverIndex((current) => (current === nextIndex ? current : nextIndex));
  }

  return (
    <div
      className={`backtest-trade-mini-chart ${chartTone}${hoverIndex == null ? "" : " is-hovering"}`}
      onMouseLeave={() => setHoverIndex(null)}
      onMouseMove={handleMouseMove}
      ref={chartRef}
    >
      <svg
        style={{ height: `${plot.height}px` }}
        viewBox={`0 0 ${plot.width} ${plot.height}`}
        role="img"
        aria-label={`${displaySymbol(trade)} per-trade price movement`}
      >
        <defs>
          <clipPath id={`${chartId}-reveal`}>
            <rect
              className={isOpen ? "backtest-trade-mini-reveal-mask" : undefined}
              x="0"
              y="0"
              width={plot.width}
              height={plot.height}
            />
          </clipPath>
          <linearGradient id={`${chartId}-area`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" className="backtest-trade-mini-area-start" />
            <stop offset="100%" className="backtest-trade-mini-area-end" />
          </linearGradient>
          <linearGradient id={`${chartId}-tp-zone`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(52,211,153,0.14)" />
            <stop offset="100%" stopColor="rgba(52,211,153,0.01)" />
          </linearGradient>
          <linearGradient id={`${chartId}-sl-zone`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(248,113,113,0.01)" />
            <stop offset="100%" stopColor="rgba(248,113,113,0.15)" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={plot.width} height={plot.height} className="backtest-trade-mini-bg" />

        {plot.levelSegments.map((segment, index) =>
          segment.tone === "entry" || segment.tone === "limit" ? null : (
            <rect
              key={`zone-${segment.tone}-${index}`}
              x={Math.min(segment.x1, segment.x2)}
              y={Math.min(segment.y, plot.entryY)}
              width={Math.abs(segment.x2 - segment.x1)}
              height={Math.abs(plot.entryY - segment.y)}
              className={`backtest-trade-mini-zone ${segment.tone}`}
              fill={`url(#${chartId}-${segment.tone === "tp" ? "tp" : "sl"}-zone)`}
            />
          )
        )}

        {plot.gridTicks.map((value, index) => {
          const y = plot.scaleY(value);
          return (
            <g key={`mini-grid-${index}`}>
              <line x1={plot.margins.left} x2={plot.width - plot.margins.right} y1={y} y2={y} className="backtest-trade-mini-grid-line" />
              <text x={plot.margins.left - 10} y={y + 4} className="backtest-trade-mini-axis-label y-axis" textAnchor="end">
                {formatChartPrice(value, plot.yAxisFractionDigits)}
              </text>
            </g>
          );
        })}

        {plot.xTicks.map((tick, index) => {
          const x = plot.scaleX(tick.value);
          return (
            <g key={`${tick.label}-${index}`}>
              <line
                x1={x}
                x2={x}
                y1={plot.margins.top}
                y2={plot.height - plot.margins.bottom}
                className="backtest-trade-mini-grid-line vertical"
              />
              <text
                x={x}
                y={plot.height - 16}
                className="backtest-trade-mini-axis-label x-axis"
                textAnchor={index === 0 ? "start" : index === plot.xTicks.length - 1 ? "end" : "middle"}
              >
                {tick.label}
              </text>
            </g>
          );
        })}

        <g>
          <line
            x1={plot.entryLevel.x1}
            x2={plot.entryLevel.x2}
            y1={plot.entryLevel.y}
            y2={plot.entryLevel.y}
            className="backtest-trade-mini-level entry"
          />
          <text x={plot.margins.left + 8} y={plot.entryLevel.y - 7} className="backtest-trade-mini-level-label entry">
            {plot.entryLevel.label}
          </text>
        </g>

        {plot.limitEntryLine ? (
          <g>
            <line
              x1={plot.limitEntryLine.x1}
              x2={plot.limitEntryLine.x2}
              y1={plot.limitEntryLine.y}
              y2={plot.limitEntryLine.y}
              className="backtest-trade-mini-level limit"
            />
            <text x={plot.limitEntryLine.x2 + 6} y={plot.limitEntryLine.y + 14} className="backtest-trade-mini-level-label limit">
              {plot.limitEntryLine.label}
            </text>
          </g>
        ) : null}

        {plot.levelSegments.map((segment, index) => (
          <g key={`level-${segment.tone}-${index}-${segment.value}`}>
            <line
              x1={segment.x1}
              x2={segment.x2}
              y1={segment.y}
              y2={segment.y}
              className={`backtest-trade-mini-level ${segment.tone}`}
            />
            {segment.label ? (
              <text x={Math.min(segment.x1 + 8, plot.width - plot.margins.right - 48)} y={segment.y - 7} className={`backtest-trade-mini-level-label ${segment.tone}`}>
                {segment.label}
              </text>
            ) : null}
          </g>
        ))}

        {plot.levelConnectors.map((connector, index) => (
          <line
            key={`connector-${connector.tone}-${index}`}
            x1={connector.x}
            x2={connector.x}
            y1={connector.y1}
            y2={connector.y2}
            className={`backtest-trade-mini-level ${connector.tone} connector`}
          />
        ))}

        {plot.managedLevelPaths.map((level) => (
          <path
            key={`managed-level-path-${level.tone}`}
            className={`backtest-trade-mini-managed-path ${level.tone}`}
            d={level.d}
            fill="none"
          />
        ))}

        {plot.managementMarkers.map((marker, index) => (
          <g key={`management-marker-${marker.tone}-${index}`} className={`backtest-trade-mini-managed-marker ${marker.tone}`}>
            <circle cx={marker.x} cy={marker.y} r="4" />
            <text x={marker.x + 7} y={marker.y - 7}>
              {marker.label}
            </text>
          </g>
        ))}

        {plot.points.map((point, index) => {
          const highY = plot.scaleY(point.high);
          const lowY = plot.scaleY(point.low);
          const tone = point.pnlDollars > 0 ? "up" : point.pnlDollars < 0 ? "down" : "flat";
          return (
            <line
              key={`${point.timeMs}-${index}`}
              x1={point.xCoord}
              x2={point.xCoord}
              y1={highY}
              y2={lowY}
              className={`backtest-trade-mini-range ${tone}`}
            />
          );
        })}

        <g className={isOpen ? "backtest-trade-mini-reveal" : undefined} clipPath={isOpen ? `url(#${chartId}-reveal)` : undefined}>
          <path d={plot.areaPath} className="backtest-trade-mini-area" fill={`url(#${chartId}-area)`} />
          <g>
            {plot.segments.map((segment, index) => (
              <path
                key={`${segment.d}-${index}`}
                className={`backtest-trade-mini-segment ${segment.tone}`}
                d={segment.d}
                fill="none"
                pathLength={1}
              />
            ))}
          </g>
        </g>

        <g className="backtest-trade-mini-marker mfe">
          <circle cx={plot.points[plot.mfeIndex]!.xCoord} cy={plot.scaleY(plot.points[plot.mfeIndex]!.favorablePrice)} r="4" />
          <text
            x={plot.points[plot.mfeIndex]!.xCoord > plot.width * 0.72 ? plot.points[plot.mfeIndex]!.xCoord - 8 : plot.points[plot.mfeIndex]!.xCoord + 8}
            y={plot.scaleY(plot.points[plot.mfeIndex]!.favorablePrice) - 8}
            textAnchor={plot.points[plot.mfeIndex]!.xCoord > plot.width * 0.72 ? "end" : "start"}
          >
            MFE {formatSignedMoney(plot.points[plot.mfeIndex]!.favorablePnl)}
          </text>
        </g>
        <g className="backtest-trade-mini-marker mae">
          <circle cx={plot.points[plot.maeIndex]!.xCoord} cy={plot.scaleY(plot.points[plot.maeIndex]!.adversePrice)} r="4" />
          <text
            x={plot.points[plot.maeIndex]!.xCoord > plot.width * 0.72 ? plot.points[plot.maeIndex]!.xCoord - 8 : plot.points[plot.maeIndex]!.xCoord + 8}
            y={plot.scaleY(plot.points[plot.maeIndex]!.adversePrice) + 16}
            textAnchor={plot.points[plot.maeIndex]!.xCoord > plot.width * 0.72 ? "end" : "start"}
          >
            MAE {formatSignedMoney(plot.points[plot.maeIndex]!.adversePnl)}
          </text>
        </g>
        <g className={`backtest-trade-mini-marker exit ${isTradeWinner ? "up" : "down"}`}>
          <circle cx={plot.points[plot.points.length - 1]!.xCoord} cy={plot.points[plot.points.length - 1]!.yCoord} r="5" />
          <text x={plot.points[plot.points.length - 1]!.xCoord - 8} y={plot.points[plot.points.length - 1]!.yCoord - 12} textAnchor="end">
            {isStillOpen ? "Mark" : "Exit"} {trade.pnlLabel}
          </text>
        </g>

        {hoverIndex == null ? null : (
          <g className="backtest-trade-mini-crosshair">
            <line x1={activeX} x2={activeX} y1={plot.margins.top} y2={plot.height - plot.margins.bottom} />
            <line x1={plot.margins.left} x2={plot.width - plot.margins.right} y1={activeY} y2={activeY} />
            <circle cx={activeX} cy={activeY} r="5" />
          </g>
        )}
      </svg>
      {hoverIndex == null ? null : (
        <div
          className={`backtest-trade-mini-tooltip ${tooltipSide}`}
          style={{
            left: `${(activeX / plot.width) * 100}%`,
            top: `calc(${tooltipTopRatio * 100}% - ${(tooltipTopRatio * 31).toFixed(2)}px)`
          }}
        >
          {compactTooltip ? (
            <div className="backtest-trade-mini-tooltip-simple">
              <span>
                <small>Elapsed</small>
                <strong>{formatMinutesCompact(activePoint.x)}</strong>
              </span>
              <span>
                <small>PnL</small>
                <strong className={activePnlTone}>{formatSignedMoney(activePoint.pnlDollars)}</strong>
              </span>
              <span>
                <small>Price</small>
                <strong>{formatChartPrice(activePoint.price)}</strong>
              </span>
            </div>
          ) : (
            <>
              <div className="backtest-trade-mini-tooltip-head">
                <div>
                  <strong>{displaySymbol(trade)} {trade.sideLabel}</strong>
                  <span>{trade.modelName}</span>
                </div>
                <strong className={activePnlTone}>{formatSignedMoney(activePoint.pnlDollars)}</strong>
              </div>
              <div className="backtest-trade-mini-tooltip-price">
                <span>
                  <small>Time</small>
                  <strong>{formatCalendarDateTime(new Date(activePoint.timeMs).toISOString())}</strong>
                </span>
                <span>
                  <small>Price</small>
                  <strong>{formatChartPrice(activePoint.price)}</strong>
                </span>
              </div>
              <div className="backtest-trade-mini-tooltip-grid">
                <span>
                  <small>Elapsed</small>
                  <strong>{formatMinutesCompact(activePoint.x)}</strong>
                </span>
                <span>
                  <small>Size</small>
                  <strong>{trade.sizeLabel}</strong>
                </span>
                <span>
                  <small>MFE</small>
                  <strong className="up">{formatSignedMoney(activePoint.runningMfe)}</strong>
                </span>
                <span>
                  <small>MAE</small>
                  <strong className="down">{formatSignedMoney(activePoint.runningMae)}</strong>
                </span>
                <span>
                  <small>TP Gap</small>
                  <strong className={targetGapDollars >= 0 ? "up" : "down"}>{formatSignedMoney(targetGapDollars)}</strong>
                </span>
                <span>
                  <small>SL Buffer</small>
                  <strong className={stopBufferDollars >= 0 ? "up" : "down"}>{formatSignedMoney(stopBufferDollars)}</strong>
                </span>
              </div>
              <div className="backtest-trade-mini-tooltip-levels">
                <span>
                  <small>Entry</small>
                  <strong>{trade.entryPriceLabel}</strong>
                </span>
                <span>
                  <small>TP</small>
                  <strong className="up">{formatChartPrice(activeLevels.targetPrice)}</strong>
                </span>
                <span>
                  <small>SL</small>
                  <strong className="down">{formatChartPrice(activeLevels.stopPrice)}</strong>
                </span>
              </div>
            </>
          )}
        </div>
      )}
      <div className="backtest-trade-mini-legend" aria-hidden="true">
        <span className="price">Price path</span>
        <span className="range">High/low range</span>
        <span className="zone">TP/SL zones</span>
      </div>
    </div>
  );
}

export function TradeHistoryCalendar({ rows }: TradeHistoryProps) {
  const isRestricted = !useAutoTradeAdminMode();
  const [selectedMonthKey, setSelectedMonthKey] = useState(() => pacificMonthKey(rows[0]?.entryTime));
  const [selectedDateKey, setSelectedDateKey] = useState(() => pacificDateKey(rows[0]?.entryTime));
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [chartStates, setChartStates] = useState<Record<string, CalendarChartState>>({});
  const chartStatesRef = useRef<Record<string, CalendarChartState>>({});
  const activityByDay = useMemo(() => {
    const activity = new Map<string, CalendarActivity>();
    for (const trade of rows) {
      const key = pacificDateKey(trade.entryTime);
      if (!key) continue;
      const current = activity.get(key) ?? { count: 0, pnl: 0, wins: 0, items: [] };
      current.count += 1;
      current.pnl += trade.pnlDollars;
      current.wins += trade.pnlDollars > 0 ? 1 : 0;
      current.items.push(trade);
      activity.set(key, current);
    }
    for (const value of activity.values()) {
      value.items.sort((left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime));
    }
    return activity;
  }, [rows]);
  const latestDateKey = useMemo(() => {
    const latest = [...activityByDay.keys()].sort((left, right) => right.localeCompare(left))[0];
    return latest ?? "";
  }, [activityByDay]);
  const activeMonthKey = selectedMonthKey || (latestDateKey ? latestDateKey.slice(0, 7) : pacificMonthKey(new Date()));
  const calendarGrid = useMemo(() => buildCalendarGrid(activeMonthKey, activityByDay), [activeMonthKey, activityByDay]);
  const selectedDayTrades = useMemo(
    () => (selectedDateKey ? activityByDay.get(selectedDateKey)?.items ?? [] : []),
    [activityByDay, selectedDateKey]
  );
  const selectedMonthPnl = calendarGrid.reduce((sum, cell) => (cell.inMonth && cell.activity ? sum + cell.activity.pnl : sum), 0);
  const expandedTrade = expandedTradeId ? rows.find((trade) => trade.id === expandedTradeId) ?? null : null;

  useEffect(() => {
    if (!latestDateKey) return;
    setSelectedMonthKey((current) => current || latestDateKey.slice(0, 7));
    setSelectedDateKey((current) => current || latestDateKey);
  }, [latestDateKey]);

  useEffect(() => {
    setExpandedTradeId((current) => (current && selectedDayTrades.some((trade) => trade.id === current) ? current : null));
  }, [selectedDayTrades]);

  useEffect(() => {
    chartStatesRef.current = chartStates;
  }, [chartStates]);

  useEffect(() => {
    if (!expandedTrade) return undefined;
    const existing = chartStatesRef.current[expandedTrade.id];
    const isOpen = Boolean(expandedTrade.isOpen);
    if (!isOpen && existing && existing.status !== "idle" && existing.status !== "error") return undefined;

    const controller = new AbortController();
    const params = new URLSearchParams({
      context: "8",
      entryIndex: String(expandedTrade.entryIndex),
      entryTime: expandedTrade.entryTime,
      exitIndex: String(expandedTrade.exitIndex),
      exitTime: expandedTrade.exitTime,
      market: expandedTrade.market ?? "",
      symbol: expandedTrade.symbol,
      timeframe: expandedTrade.sourceTimeframe ?? "1m"
    });
    if (isOpen) params.set("open", "1");

    if (!existing?.bars.length) {
      setChartStates((current) => ({
        ...current,
        [expandedTrade.id]: { status: "loading", bars: [] }
      }));
    }

    let inFlight = false;
    const refreshChart = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/trade-chart?${params.toString()}`, {
          cache: isOpen ? "no-store" : "default",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Chart unavailable");
        const payload = (await response.json()) as ChartPayload;
        const nextBars = payload.replayBars?.length ? payload.replayBars : payload.bars ?? [];
        setChartStates((current) => ({
          ...current,
          [expandedTrade.id]: nextBars.length
            ? { status: "ready", bars: nextBars, message: payload.error }
            : current[expandedTrade.id]?.bars.length
              ? current[expandedTrade.id]!
              : { status: "error", bars: [], message: payload.error ?? "Price movement unavailable." }
        }));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setChartStates((current) => ({
          ...current,
          [expandedTrade.id]: current[expandedTrade.id]?.bars.length
            ? current[expandedTrade.id]!
            : { status: "error", bars: [], message: error instanceof Error ? error.message : "Chart unavailable" }
        }));
      } finally {
        inFlight = false;
      }
    };

    void refreshChart();
    const intervalId = isOpen ? window.setInterval(() => void refreshChart(), OPEN_TRADE_CHART_REFRESH_MS) : null;
    return () => {
      controller.abort();
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [expandedTrade]);

  return (
    <div className="backtest-grid">
      <div className="backtest-calendar-shell">
        <div className="backtest-calendar-toolbar">
          <div className="backtest-calendar-nav compact">
            <button
              type="button"
              className="backtest-action-btn backtest-calendar-nav-btn"
              onClick={() => setSelectedMonthKey((current) => shiftMonthKey(current || activeMonthKey, -1))}
            >
              {"<"}
            </button>
            <span className="backtest-calendar-label">{monthLabel(activeMonthKey)}</span>
            <button
              type="button"
              className="backtest-action-btn backtest-calendar-nav-btn"
              onClick={() => setSelectedMonthKey((current) => shiftMonthKey(current || activeMonthKey, 1))}
            >
              {">"}
            </button>
          </div>
        </div>

        <div className="backtest-calendar-summary">
          <div className={`backtest-month-pill ${selectedMonthPnl > 0 ? "up" : selectedMonthPnl < 0 ? "down" : "neutral"}`}>
            {monthLabel(activeMonthKey)} PnL: {formatSignedMoney(selectedMonthPnl)}
          </div>
        </div>
      </div>

      <div className="backtest-calendar-weekdays">
        {CALENDAR_DOW_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="backtest-calendar-grid">
        {calendarGrid.map((cell) => (
          <button
            key={cell.dateKey}
            type="button"
            className={`backtest-calendar-cell ${cell.dateKey === selectedDateKey ? "selected" : ""} ${cell.inMonth ? "" : "muted"}`}
            onClick={() => setSelectedDateKey(cell.dateKey)}
          >
            <div className="backtest-calendar-cell-day">{cell.day}</div>
            {cell.activity ? (
              <>
                <div className="backtest-calendar-cell-count">
                  {cell.activity.count} trade{cell.activity.count === 1 ? "" : "s"}
                </div>
                <div className={`backtest-calendar-cell-pnl ${cell.activity.pnl >= 0 ? "up" : "down"}`}>
                  {formatSignedMoney(cell.activity.pnl)}
                </div>
              </>
            ) : (
              <div className="backtest-calendar-cell-empty">No trades</div>
            )}
          </button>
        ))}
      </div>

      <div className="backtest-calendar-detail">
        <div className="backtest-card-head backtest-calendar-detail-head">
          <div>
            <h3>{selectedDateKey || "Select a day"}</h3>
            <p>
              {selectedDateKey
                ? `${weekdayLabel(selectedDateKey)}, ${calendarDateLabel(selectedDateKey)} - ${selectedDayTrades.length} trade${
                    selectedDayTrades.length === 1 ? "" : "s"
                  }`
                : "Select a day in the grid to inspect the matching trade set."}
            </p>
          </div>
        </div>

        <div className="backtest-calendar-day-list">
          {selectedDayTrades.map((sourceTrade) => {
            const isExpanded = expandedTradeId === sourceTrade.id;
            const chartState = chartStates[sourceTrade.id] ?? { status: "idle", bars: [] };
            const trade = withOpenTradeChartMark(sourceTrade, chartState.bars);
            const durationMinutes = tradeDurationMinutes(trade);
            const displayedModelName = isRestricted ? "Admin only" : trade.modelName;
            const visibleSymbol = displaySymbol(trade);
            const resolvedDurationLabel = tradePathDurationLabel(trade, chartState.bars);
            return (
              <div key={`${trade.id}-calendar`} className={`backtest-calendar-trade ${isExpanded ? "expanded" : ""}`}>
                <button
                  type="button"
                  className="backtest-calendar-trade-toggle"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${visibleSymbol} trade details`}
                  onClick={() => setExpandedTradeId((current) => (current === trade.id ? null : trade.id))}
                >
                  <div className="backtest-calendar-trade-main">
                    <span className={`backtest-calendar-side-pill ${trade.side === "long" ? "up" : "down"}`}>
                      {trade.side === "long" ? "BUY" : "SELL"}
                    </span>
                    <div className="backtest-calendar-trade-copy">
                      <div className="backtest-calendar-trade-model" title={displayedModelName}>
                        {displayedModelName}
                      </div>
                      <div className="backtest-calendar-trade-inline">
                        <span className="backtest-calendar-trade-inline-label">Entry ({trade.sourceTimeframe ?? "1m"}):</span>
                        <span className="backtest-calendar-trade-inline-value">{formatCalendarDateTime(trade.entryTime)}</span>
                        <span className="backtest-calendar-trade-inline-price">@ {formatChartPrice(trade.entryPrice)}</span>
                      </div>
                      <div className="backtest-calendar-trade-inline optional">
                        <span className="backtest-calendar-trade-inline-label">{trade.isOpen ? "Mark" : "Exit"} ({trade.sourceTimeframe ?? "1m"}):</span>
                        <span className="backtest-calendar-trade-inline-value">{formatCalendarDateTime(trade.exitTime)}</span>
                        <span className="backtest-calendar-trade-inline-price">@ {formatChartPrice(trade.exitPrice)}</span>
                      </div>
                      <div className="backtest-calendar-trade-duration">Duration: {formatMinutesCompact(durationMinutes)}</div>
                    </div>
                  </div>
                  <div className="backtest-calendar-trade-side">
                    <span className="backtest-calendar-trade-symbol" title={visibleSymbol !== trade.symbol ? `Signal ${trade.symbol}` : undefined}>
                      {visibleSymbol}
                    </span>
                    <strong className={trade.pnlDollars >= 0 ? "up" : "down"}>{trade.isEstimatedPnl ? `Est. ${trade.pnlLabel}` : trade.pnlLabel}</strong>
                  </div>
                </button>

                {isExpanded ? (
                  <div className="backtest-calendar-trade-expand">
                    <div className="backtest-calendar-trade-summary">
                      <section className="backtest-calendar-trade-outcome" aria-label="Trade outcome">
                        <span className="backtest-calendar-trade-eyebrow">{trade.isEstimatedPnl ? "Estimated unrealized" : "Realized outcome"}</span>
                        <strong className={trade.pnlDollars >= 0 ? "up" : "down"}>{trade.pnlLabel}</strong>
                        <div className="backtest-calendar-trade-badges">
                          <span>{displayExitReasonLabel(trade)}</span>
                          <span>{trade.rMultipleLabel}</span>
                        </div>
                      </section>

                      <section className="backtest-calendar-trade-route" aria-label="Entry and exit">
                        <div className="backtest-calendar-trade-route-point">
                          <span>Entry</span>
                          <strong>{trade.entryPriceLabel}</strong>
                          <small>{formatCalendarDateTime(trade.entryTime)}</small>
                        </div>
                        <span className="backtest-calendar-trade-route-arrow" aria-hidden="true">&rarr;</span>
                        <div className="backtest-calendar-trade-route-point exit">
                          <span>{trade.isOpen ? "Current Mark" : "Exit"}</span>
                          <strong>{trade.exitPriceLabel}</strong>
                          <small>{formatCalendarDateTime(trade.exitTime)}</small>
                        </div>
                      </section>

                      <section className="backtest-calendar-trade-position" aria-label="Position details">
                        <span className="backtest-calendar-trade-eyebrow">Position</span>
                        <strong>
                          <span className={trade.side === "long" ? "up" : "down"}>{trade.side === "long" ? "BUY" : "SELL"}</span>
                          <span aria-hidden="true">{" / "}</span>
                          {trade.sizeLabel}
                        </strong>
                        <small>{resolvedDurationLabel}</small>
                      </section>
                    </div>

                    <div className="backtest-calendar-trade-brackets" aria-label="Planned trade levels">
                      <div className="backtest-calendar-trade-bracket tp">
                        <span>Profit target</span>
                        <strong>{trade.targetPriceLabel}</strong>
                        <small>{trade.targetLabel}</small>
                      </div>
                      <div className="backtest-calendar-trade-bracket sl">
                        <span>Protective stop</span>
                        <strong>{trade.stopPriceLabel}</strong>
                        <small>{trade.riskLabel}</small>
                      </div>
                    </div>

                    <div className="backtest-calendar-trade-context" aria-label="Trade context">
                      <div>
                        <span>Session</span>
                        <strong>{sessionLabel(trade.entryTime)}</strong>
                      </div>
                      <div className="model" title={displayedModelName}>
                        <span>Entry model</span>
                        <strong>{displayedModelName}</strong>
                      </div>
                      <div>
                        <span>Timeframe</span>
                        <strong>{trade.sourceTimeframe ?? "1m"}</strong>
                      </div>
                    </div>

                    <div className="backtest-calendar-trade-panel">
                      <div className="backtest-calendar-trade-chart-copy">
                        <strong>Price movement</strong>
                        {chartState.message ? <span>{chartState.message}</span> : null}
                      </div>
                      <BacktestTradeMiniChart bars={chartState.bars} isOpen={Boolean(trade.isOpen)} status={chartState.status} trade={trade} />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {selectedDayTrades.length === 0 ? <div className="backtest-empty-inline">No trades entered on the selected day.</div> : null}
        </div>
      </div>
    </div>
  );
}

function TradeCandlestickChart({
  trade,
  bars,
  status
}: {
  trade: TradeHistoryRow;
  bars: ChartBar[];
  status: ChartState["status"];
}) {
  const chartWidth = 1040;
  const chartHeight = 360;
  const pad = 16;
  const plot = { x: pad, y: pad, width: chartWidth - pad * 2, height: chartHeight - pad * 2 - 30 };
  const candleCount = bars.length;
  const entryPosition = useMemo(() => nearestPositionForAnchor(bars, trade.entryIndex, trade.entryTime), [bars, trade.entryIndex, trade.entryTime]);
  const exitPosition = useMemo(() => nearestPositionForAnchor(bars, trade.exitIndex, trade.exitTime), [bars, trade.exitIndex, trade.exitTime]);
  const initialRange = useMemo(() => {
    if (!candleCount) return { start: 0, end: 0 };
    const tradeLength =
      entryPosition != null && exitPosition != null ? Math.max(1, Math.abs(exitPosition - entryPosition) + 1) : 30;
    const windowSize = Math.max(30, Math.ceil(tradeLength * 3));
    const anchor = entryPosition ?? 0;
    let start = Math.max(0, anchor - Math.floor(windowSize * 0.35));
    let end = Math.min(candleCount - 1, start + windowSize - 1);

    if (end - start + 1 < Math.min(windowSize, candleCount)) {
      start = Math.max(0, end - windowSize + 1);
    }

    return { start, end };
  }, [candleCount, entryPosition, exitPosition]);
  const [viewRange, setViewRange] = useState(initialRange);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const [mousePoint, setMousePoint] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<CandleMenuState | null>(null);
  const dragRef = useRef({
    dragging: false,
    startX: 0,
    startRange: initialRange
  });

  useEffect(() => {
    setViewRange(initialRange);
    setHoverPosition(null);
    setMousePoint(null);
    setContextMenu(null);
    dragRef.current = { dragging: false, startX: 0, startRange: initialRange };
  }, [initialRange, trade.id]);

  useEffect(() => {
    if (!contextMenu) return undefined;

    const close = () => setContextMenu(null);
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const closeOnMouse = (event: MouseEvent) => {
      if (event.button !== 2) close();
    };

    window.addEventListener("mousedown", closeOnMouse);
    window.addEventListener("scroll", close, true);
    window.addEventListener("wheel", close, true);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("mousedown", closeOnMouse);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [contextMenu]);

  if (status === "loading") {
    return (
      <section className="tradeCandlestickPanel isEmpty">
        <div className="tradeCandlestickHead">
          <strong>Trade Candlesticks</strong>
        </div>
        <span>Loading candles...</span>
      </section>
    );
  }

  if (!bars.length) {
    return (
      <section className="tradeCandlestickPanel isEmpty">
        <div className="tradeCandlestickHead">
          <strong>Trade Candlesticks</strong>
        </div>
        <span>No candles available for this trade.</span>
      </section>
    );
  }

  const safeStart = clamp(Math.min(viewRange.start, viewRange.end), 0, candleCount - 1);
  const safeEnd = clamp(Math.max(viewRange.start, viewRange.end), 0, candleCount - 1);
  const viewBars = bars.slice(safeStart, safeEnd + 1).map((bar, offset) => ({ bar, position: safeStart + offset }));
  const firstPosition = viewBars[0]?.position ?? safeStart;
  const lastPosition = viewBars[viewBars.length - 1]?.position ?? Math.max(safeStart + 1, safeEnd);
  const visibleSpan = Math.max(1, lastPosition - firstPosition);
  const direction = trade.side === "long" ? 1 : -1;
  const entrySide = direction === 1 ? "Buy" : "Sell";
  const exitSide = direction === 1 ? "Sell" : "Buy";
  const importantPrices = [trade.entryPrice, trade.exitPrice, trade.targetPrice, trade.stopPrice].filter(Number.isFinite);
  const lows = viewBars.map(({ bar }) => bar.low).filter(Number.isFinite);
  const highs = viewBars.map(({ bar }) => bar.high).filter(Number.isFinite);
  const minPrice = Math.min(...lows, ...importantPrices);
  const maxPrice = Math.max(...highs, ...importantPrices);
  const priceSpan = Math.max(0.0000001, maxPrice - minPrice);
  const yPadding = Math.max(priceSpan * 0.045, Math.abs(trade.entryPrice) * 0.00008, 0.02);
  const low = minPrice - yPadding;
  const high = maxPrice + yPadding;
  const candleWidth = Math.max(2, Math.min(18, (plot.width / Math.max(1, viewBars.length)) * 0.7));
  const hoveredBar = hoverPosition == null ? null : bars[hoverPosition] ?? null;
  const entryInView = entryPosition != null && entryPosition >= firstPosition && entryPosition <= lastPosition;
  const exitInView = exitPosition != null && exitPosition >= firstPosition && exitPosition <= lastPosition;

  function xForPosition(position: number): number {
    return plot.x + ((position - firstPosition) / visibleSpan) * plot.width;
  }

  function yForPrice(price: number): number {
    return plot.y + ((high - price) / (high - low || 1)) * plot.height;
  }

  function positionFromMouseX(x: number): number {
    const pct = clamp((x - plot.x) / plot.width, 0, 1);
    return Math.round(firstPosition + pct * visibleSpan);
  }

  function svgPoint(event: ReactMouseEvent<SVGSVGElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * chartWidth,
      y: ((event.clientY - rect.top) / rect.height) * chartHeight
    };
  }

  function handleMouseMove(event: ReactMouseEvent<SVGSVGElement>) {
    const point = svgPoint(event);
    setMousePoint(point);

    if (dragRef.current.dragging) {
      const deltaX = point.x - dragRef.current.startX;
      const visibleBars = dragRef.current.startRange.end - dragRef.current.startRange.start + 1;
      const barsPerPixel = visibleBars / plot.width;
      const shift = Math.round(-deltaX * barsPerPixel);
      let nextStart = dragRef.current.startRange.start + shift;
      let nextEnd = dragRef.current.startRange.end + shift;

      if (nextStart < 0) {
        nextEnd -= nextStart;
        nextStart = 0;
      }
      if (nextEnd > candleCount - 1) {
        const overshoot = nextEnd - (candleCount - 1);
        nextStart = Math.max(0, nextStart - overshoot);
        nextEnd = candleCount - 1;
      }

      setViewRange({ start: nextStart, end: nextEnd });
      return;
    }

    setHoverPosition(clamp(positionFromMouseX(point.x), 0, candleCount - 1));
  }

  function handleMouseDown(event: ReactMouseEvent<SVGSVGElement>) {
    if (event.button === 2) return;
    const point = svgPoint(event);
    dragRef.current = {
      dragging: true,
      startX: point.x,
      startRange: { start: safeStart, end: safeEnd }
    };
  }

  function handleMouseLeave() {
    setMousePoint(null);
    setHoverPosition(null);
    dragRef.current.dragging = false;
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    if (candleCount < 5) return;
    const point = svgPoint(event);
    const centerPosition = clamp(positionFromMouseX(point.x), 0, candleCount - 1);
    const currentWindow = Math.max(5, safeEnd - safeStart + 1);
    const nextWindow = clamp(Math.round(currentWindow * (event.deltaY < 0 ? 0.85 : 1.18)), 10, candleCount);
    const anchorPct = currentWindow <= 1 ? 0.5 : (centerPosition - safeStart) / currentWindow;
    let nextStart = Math.round(centerPosition - nextWindow * anchorPct);
    let nextEnd = nextStart + nextWindow - 1;

    if (nextStart < 0) {
      nextEnd -= nextStart;
      nextStart = 0;
    }
    if (nextEnd > candleCount - 1) {
      const overshoot = nextEnd - (candleCount - 1);
      nextStart = Math.max(0, nextStart - overshoot);
      nextEnd = candleCount - 1;
    }

    setViewRange({ start: nextStart, end: nextEnd });
  }

  function handleContextMenu(event: ReactMouseEvent<SVGSVGElement>) {
    const point = svgPoint(event);
    const position = clamp(positionFromMouseX(point.x), 0, candleCount - 1);
    const candle = bars[position];
    if (!candle) return;
    event.preventDefault();
    setContextMenu({ clientX: event.clientX, clientY: event.clientY, candle });
  }

  function drawLevel(price: number, color: string, label: string, solid = false) {
    if (!Number.isFinite(price)) return null;
    const y = yForPrice(price);
    return (
      <g>
        <line
          x1={plot.x}
          y1={y}
          x2={plot.x + plot.width}
          y2={y}
          stroke={color}
          strokeDasharray={solid ? undefined : "6 6"}
          opacity={0.92}
        />
        <text x={plot.x + 8} y={y - 6} fill={color} fontSize={12} fontFamily="ui-sans-serif, system-ui">
          {label} {formatChartPrice(price)}
        </text>
      </g>
    );
  }

  function arrow(x: number, tipY: number, arrowDirection: "up" | "down", color: string) {
    const head = 5;
    const stem = 7;
    const headPath =
      arrowDirection === "up"
        ? `M ${x} ${tipY} L ${x - head} ${tipY + head} L ${x + head} ${tipY + head} Z`
        : `M ${x} ${tipY} L ${x - head} ${tipY - head} L ${x + head} ${tipY - head} Z`;
    const stemY1 = arrowDirection === "up" ? tipY + head : tipY - head;
    const stemY2 = arrowDirection === "up" ? tipY + head + stem : tipY - head - stem;

    return (
      <g>
        <path d={headPath} fill={color} stroke="rgba(0,0,0,0.55)" strokeWidth={1.2} opacity={0.98} />
        <line x1={x} y1={stemY1} x2={x} y2={stemY2} stroke={color} strokeWidth={1.7} strokeLinecap="round" opacity={0.98} />
      </g>
    );
  }

  function markerAt(position: number, label: string, placement: "above" | "below", arrowDirection: "up" | "down", color: string) {
    const bar = bars[position];
    if (!bar) return null;
    const x = xForPosition(position);
    const highY = yForPrice(bar.high);
    const lowY = yForPrice(bar.low);
    const tipY =
      placement === "below"
        ? clamp(lowY + 4, plot.y + 6, plot.y + plot.height - 6)
        : clamp(highY - 4, plot.y + 6, plot.y + plot.height - 6);
    const textY = placement === "below" ? tipY + 18 : tipY - 12;

    return (
      <g>
        {arrow(x, tipY, arrowDirection, color)}
        <text
          x={x}
          y={textY}
          fill={color}
          fontSize={8}
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui"
          fontWeight={650}
          style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.75)", strokeWidth: 3 }}
        >
          {label}
        </text>
      </g>
    );
  }

  const xAxisTicks = Array.from({ length: Math.min(6, Math.max(3, Math.floor(viewBars.length / 30) + 2)) })
    .map((_, tickIndex, ticks) => {
      const indexInView = ticks.length <= 1 ? 0 : Math.round((tickIndex * (viewBars.length - 1)) / (ticks.length - 1));
      const point = viewBars[indexInView];
      if (!point) return null;
      return {
        key: `${tickIndex}-${point.position}-${point.bar.time}`,
        x: xForPosition(point.position),
        label: axisTimeLabel(point.bar.time)
      };
    })
    .filter((tick): tick is { key: string; x: number; label: string } => Boolean(tick?.label));

  return (
    <section className="tradeCandlestickPanel">
      <div className="tradeCandlestickHead">
        <strong>Trade Candlesticks</strong>
        <span>Showing {viewBars.length} / {candleCount} candles</span>
      </div>

      <svg
        className="tradeCandlestickSvg"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${displaySymbol(trade)} trade candlestick chart`}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={() => {
          dragRef.current.dragging = false;
        }}
        onWheel={handleWheel}
        onDoubleClick={() => setViewRange(initialRange)}
        onContextMenu={handleContextMenu}
      >
        <rect x={0} y={0} width={chartWidth} height={chartHeight} fill="rgba(0,0,0,0.92)" />

        {Array.from({ length: 6 }).map((_, index) => {
          const y = plot.y + (plot.height * index) / 5;
          return <line key={`grid-y-${index}`} x1={plot.x} y1={y} x2={plot.x + plot.width} y2={y} stroke="rgba(255,255,255,0.10)" strokeDasharray="4 6" />;
        })}
        {Array.from({ length: 8 }).map((_, index) => {
          const x = plot.x + (plot.width * index) / 7;
          return <line key={`grid-x-${index}`} x1={x} y1={plot.y} x2={x} y2={plot.y + plot.height} stroke="rgba(255,255,255,0.10)" strokeDasharray="4 6" />;
        })}

        <line x1={plot.x} y1={plot.y + plot.height} x2={plot.x + plot.width} y2={plot.y + plot.height} stroke="rgba(255,255,255,0.22)" />
        {xAxisTicks.map((tick, index) => (
          <g key={tick.key}>
            <line x1={tick.x} y1={plot.y + plot.height} x2={tick.x} y2={plot.y + plot.height + 4} stroke="rgba(255,255,255,0.30)" />
            <text
              x={tick.x}
              y={plot.y + plot.height + 17}
              fill="rgba(255,255,255,0.68)"
              fontSize={11}
              fontFamily="ui-sans-serif, system-ui"
              textAnchor={index === 0 ? "start" : index === xAxisTicks.length - 1 ? "end" : "middle"}
            >
              {tick.label}
            </text>
          </g>
        ))}

        {drawLevel(trade.entryPrice, "#ffffff", "Entry", true)}
        {drawLevel(trade.targetPrice, "#34d399", "TP")}
        {drawLevel(trade.stopPrice, "#fb7185", "SL")}

        {viewBars.map(({ bar, position }, index) => {
          const up = bar.close >= bar.open;
          const color = up ? "rgba(52,211,153,0.92)" : "rgba(248,113,113,0.92)";
          const x = xForPosition(position);
          const openY = yForPrice(bar.open);
          const closeY = yForPrice(bar.close);
          const highY = yForPrice(bar.high);
          const lowY = yForPrice(bar.low);
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(closeY - openY));
          const hovered = hoverPosition === position;

          return (
            <g key={`${position}-${index}-${bar.index}-${bar.time}`}>
              <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth={2} opacity={0.95} />
              <rect x={x - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} fill={color} opacity={0.92} rx={1.5} />
              {hovered ? (
                <rect
                  x={x - candleWidth / 2 - 2}
                  y={bodyY - 2}
                  width={candleWidth + 4}
                  height={bodyHeight + 4}
                  fill="none"
                  stroke="rgba(255,255,255,0.55)"
                  strokeWidth={1}
                  rx={2}
                />
              ) : null}
            </g>
          );
        })}

        {entryInView && entryPosition != null
          ? markerAt(
              entryPosition,
              "Entry",
              direction === 1 ? "below" : "above",
              direction === 1 ? "up" : "down",
              direction === 1 ? "#34d399" : "#fb7185"
            )
          : null}
        {exitInView && exitPosition != null
          ? markerAt(
              exitPosition,
              "Exit",
              direction === 1 ? "above" : "below",
              direction === 1 ? "down" : "up",
              direction === 1 ? "#fb7185" : "#34d399"
            )
          : null}

        {mousePoint && mousePoint.x >= plot.x && mousePoint.x <= plot.x + plot.width && mousePoint.y >= plot.y && mousePoint.y <= plot.y + plot.height ? (
          <g>
            <line x1={mousePoint.x} y1={plot.y} x2={mousePoint.x} y2={plot.y + plot.height} stroke="rgba(255,255,255,0.22)" strokeDasharray="4 6" />
            <line x1={plot.x} y1={mousePoint.y} x2={plot.x + plot.width} y2={mousePoint.y} stroke="rgba(255,255,255,0.22)" strokeDasharray="4 6" />
          </g>
        ) : null}

        {hoveredBar && mousePoint ? (
          <g>
            {(() => {
              const boxWidth = 260;
              const boxHeight = 90;
              let x = mousePoint.x + 12;
              let y = mousePoint.y + 12;
              if (x + boxWidth > chartWidth - 10) x = mousePoint.x - boxWidth - 12;
              if (y + boxHeight > chartHeight - 10) y = mousePoint.y - boxHeight - 12;
              return (
                <>
                  <rect x={x} y={y} width={boxWidth} height={boxHeight} rx={10} fill="rgba(15,15,15,0.92)" stroke="rgba(255,255,255,0.12)" />
                  <text x={x + 12} y={y + 22} fill="rgba(255,255,255,0.86)" fontSize={12} fontFamily="ui-sans-serif, system-ui">
                    {timeLabel(hoveredBar.time)}
                  </text>
                  <text x={x + 12} y={y + 44} fill="rgba(255,255,255,0.86)" fontSize={12} fontFamily="ui-sans-serif, system-ui">
                    O {formatChartPrice(hoveredBar.open)} H {formatChartPrice(hoveredBar.high)}
                  </text>
                  <text x={x + 12} y={y + 64} fill="rgba(255,255,255,0.86)" fontSize={12} fontFamily="ui-sans-serif, system-ui">
                    L {formatChartPrice(hoveredBar.low)} C {formatChartPrice(hoveredBar.close)}
                  </text>
                  <text x={x + 12} y={y + 84} fill="rgba(255,255,255,0.55)" fontSize={11} fontFamily="ui-sans-serif, system-ui">
                    idx {hoveredBar.index}
                  </text>
                </>
              );
            })()}
          </g>
        ) : null}
      </svg>

      {contextMenu ? (
        <CandleContextMenu state={contextMenu} />
      ) : null}
    </section>
  );
}

function CandleContextMenu({ state }: { state: CandleMenuState }) {
  const { candle } = state;
  const bullish = candle.close >= candle.open;
  const change = candle.close - candle.open;
  const changePct = candle.open !== 0 ? (change / candle.open) * 100 : 0;
  const range = candle.high - candle.low;
  const body = Math.abs(change);
  const date = new Date(candle.time);
  let left = state.clientX + 4;
  let top = state.clientY + 4;

  if (typeof window !== "undefined") {
    if (left + 250 > window.innerWidth - 8) left = state.clientX - 254;
    if (top + 270 > window.innerHeight - 8) top = state.clientY - 274;
  }

  function row(label: string, value: string, tone: string) {
    return (
      <div className="tradeCandleContextRow" key={label}>
        <span>{label}</span>
        <strong style={{ color: tone }}>{value}</strong>
      </div>
    );
  }

  return (
    <div className="tradeCandleContextMenu" style={{ left, top }} onContextMenu={(event) => event.preventDefault()}>
      <div className="tradeCandleContextHead">
        <span>{date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
        <span>{date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="tradeCandleContextTone">
        <i style={{ background: bullish ? "#34d399" : "#fb7185" }} />
        <strong style={{ color: bullish ? "#34d399" : "#fb7185" }}>{bullish ? "Bullish" : "Bearish"}</strong>
      </div>
      {row("Open", formatChartPrice(candle.open), "rgba(255,255,255,0.85)")}
      {row("High", formatChartPrice(candle.high), "#34d399")}
      {row("Low", formatChartPrice(candle.low), "#fb7185")}
      {row("Close", formatChartPrice(candle.close), bullish ? "#34d399" : "#fb7185")}
      <div className="tradeCandleContextRule" />
      {row("Change", `${change >= 0 ? "+" : ""}${formatChartPrice(change)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`, bullish ? "#34d399" : "#fb7185")}
      {row("Range", formatChartPrice(range), "#fbbf24")}
      {row("Body", formatChartPrice(body), "rgba(255,255,255,0.50)")}
    </div>
  );
}

export default function TradeHistory({ rows }: TradeHistoryProps) {
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [chartState, setChartState] = useState<ChartState>({ status: "idle", bars: [] });
  const [chartTimeframe, setChartTimeframe] = useState<TradeChartTimeframe>("1m");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isRestricted = !useAutoTradeAdminMode();
  const activeTrade = useMemo(
    () => (activeTradeId ? rows.find((row) => row.id === activeTradeId) ?? null : null),
    [activeTradeId, rows]
  );
  const activeSourceBars = chartState.sourceBars?.length ? chartState.sourceBars : chartState.bars;
  const activeDisplayTrade = useMemo(
    () => (activeTrade ? withOpenTradeChartMark(activeTrade, activeSourceBars) : null),
    [activeSourceBars, activeTrade]
  );
  const activeChartTrade = useMemo(
    () =>
      activeDisplayTrade
        ? {
            id: activeDisplayTrade.id,
            symbol: activeDisplayTrade.symbol,
            side: activeDisplayTrade.side,
            entryIndex: activeDisplayTrade.entryIndex,
            exitIndex: activeDisplayTrade.exitIndex,
            signalTime: activeDisplayTrade.signalTime,
            entryTime: activeDisplayTrade.entryTime,
            exitTime: activeDisplayTrade.exitTime,
            sourceTimeframe: activeDisplayTrade.sourceTimeframe,
            strategyTimeframe: activeDisplayTrade.strategyTimeframe,
            phase: activeDisplayTrade.phase,
            variantId: activeDisplayTrade.variantId,
            modelName: isRestricted ? "Admin only" : activeDisplayTrade.modelName,
            entryType: activeDisplayTrade.entryType,
            entryPrice: activeDisplayTrade.entryPrice,
            exitPrice: activeDisplayTrade.exitPrice,
            targetPrice: activeDisplayTrade.targetPrice,
            stopPrice: activeDisplayTrade.stopPrice,
            targetDollars: activeDisplayTrade.targetDollars,
            riskDollars: activeDisplayTrade.riskDollars,
            dollarsPerPricePoint: activeDisplayTrade.dollarsPerPricePoint,
            managementEvents: activeDisplayTrade.managementEvents,
            pnlLabel: activeDisplayTrade.pnlLabel,
            isOpen: activeDisplayTrade.isOpen
          }
        : null,
    [
      activeDisplayTrade?.entryIndex,
      activeDisplayTrade?.entryPrice,
      activeDisplayTrade?.entryTime,
      activeDisplayTrade?.entryType,
      activeDisplayTrade?.exitIndex,
      activeDisplayTrade?.exitPrice,
      activeDisplayTrade?.exitTime,
      activeDisplayTrade?.id,
      activeDisplayTrade?.isOpen,
      activeDisplayTrade?.managementEvents,
      activeDisplayTrade?.modelName,
      activeDisplayTrade?.phase,
      activeDisplayTrade?.pnlLabel,
      activeDisplayTrade?.side,
      activeDisplayTrade?.signalTime,
      activeDisplayTrade?.sourceTimeframe,
      activeDisplayTrade?.strategyTimeframe,
      activeDisplayTrade?.stopPrice,
      activeDisplayTrade?.symbol,
      activeDisplayTrade?.targetDollars,
      activeDisplayTrade?.targetPrice,
      activeDisplayTrade?.riskDollars,
      activeDisplayTrade?.dollarsPerPricePoint,
      activeDisplayTrade?.variantId,
      isRestricted
    ]
  );
  const activeStats = activeDisplayTrade ? tradePathStats(activeDisplayTrade, activeSourceBars) : { mfe: null, mae: null };
  const activeDurationLabel = activeDisplayTrade ? tradePathDurationLabel(activeDisplayTrade, activeSourceBars) : "";

  function openTrade(trade: TradeHistoryRow, opener?: HTMLElement) {
    previousFocusRef.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setChartTimeframe(trade.sourceTimeframe ?? "1m");
    setActiveTradeId(trade.id);
  }

  useEffect(() => {
    if (activeTradeId && !activeTrade) setActiveTradeId(null);
  }, [activeTrade, activeTradeId]);

  useEffect(() => {
    if (!activeTradeId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setActiveTradeId(null);
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          modalRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ) ?? []
        ).filter((element) => !element.hidden && element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      const previousFocus = previousFocusRef.current;
      window.requestAnimationFrame(() => previousFocus?.focus());
    };
  }, [activeTradeId]);

  useEffect(() => {
    if (!activeTrade) {
      setChartState({ status: "idle", bars: [] });
      return undefined;
    }

    const controller = new AbortController();
    const isOpen = Boolean(activeTrade.isOpen);
    const sourceTimeframe = activeTrade.sourceTimeframe ?? "1m";
    const chartParams = (timeframeValue: TradeChartTimeframe) => {
      const params = new URLSearchParams({
        symbol: activeTrade.symbol,
        market: activeTrade.market ?? "",
        entryIndex: String(activeTrade.entryIndex),
        exitIndex: String(activeTrade.exitIndex),
        entryTime: activeTrade.entryTime,
        exitTime: activeTrade.exitTime,
        timeframe: timeframeValue,
        context: String(TRADE_CHART_CONTEXT_CANDLES)
      });
      if (isOpen) params.set("open", "1");
      return params;
    };
    const fetchChartPayload = (timeframeValue: TradeChartTimeframe) =>
      fetchTradeChart(`/api/trade-chart?${chartParams(timeframeValue).toString()}`, controller.signal, isOpen);

    setChartState({ status: "loading", bars: [] });
    let inFlight = false;
    let quoteInFlight = false;
    const refreshChart = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const [payload, sourcePayload] = await Promise.all([
          fetchChartPayload(chartTimeframe),
          chartTimeframe === sourceTimeframe
            ? Promise.resolve(null)
            : fetchChartPayload(sourceTimeframe).catch((error: Error) => {
                if (error.name !== "AbortError") console.warn(error);
                return null;
              })
        ]);
          const resolvedTimeframe = payload.timeframe && TRADE_CHART_TIMEFRAMES.some((option) => option.value === payload.timeframe)
            ? payload.timeframe
            : chartTimeframe;
          const requestedTimeframe =
            payload.requestedTimeframe && TRADE_CHART_TIMEFRAMES.some((option) => option.value === payload.requestedTimeframe)
              ? payload.requestedTimeframe
              : chartTimeframe;
        const bars = payload.bars ?? [];
        setChartState((current) =>
          bars.length
            ? {
                status: "ready",
                bars,
                replayBars: payload.replayBars,
                replayTimeframe: payload.replayTimeframe,
                sourceBars: sourcePayload?.bars ?? bars,
                fallback: Boolean(payload.fallback),
                message: payload.error,
                requestedTimeframe,
                timeframe: resolvedTimeframe
              }
            : current.bars.length
              ? current
              : { status: "error", bars: [], message: payload.error }
        );
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setChartState((current) => (current.bars.length ? current : { status: "error", bars: [] }));
        }
      } finally {
        inFlight = false;
      }
    };

    const refreshLiveQuote = async () => {
      if (
        !isOpen ||
        (activeTrade.market && activeTrade.market.toLowerCase() !== "futures") ||
        quoteInFlight ||
        controller.signal.aborted
      ) return;
      quoteInFlight = true;
      try {
        const quoteParams = new URLSearchParams({ market: "futures", symbol: activeTrade.symbol });
        const response = await fetch(`/api/projectx-live-quote?${quoteParams.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) return;
        const payload = (await response.json()) as ProjectXLiveQuotePayload;
        const liveBar = payload.bar;
        if (!liveBar) return;
        setChartState((current) => {
          if (!current.bars.length) return current;
          const sourceBars = mergeLiveOpenTradeBar(current.sourceBars?.length ? current.sourceBars : current.bars, liveBar);
          return {
            ...current,
            bars: chartTimeframe === "1m" ? mergeLiveOpenTradeBar(current.bars, liveBar) : current.bars,
            replayBars:
              current.replayTimeframe === "1m" && current.replayBars?.length
                ? mergeLiveOpenTradeBar(current.replayBars, liveBar)
                : current.replayBars,
            sourceBars
          };
        });
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) console.warn("ProjectX live quote unavailable", error);
      } finally {
        quoteInFlight = false;
      }
    };

    void refreshChart();
    void refreshLiveQuote();
    const intervalId = isOpen ? window.setInterval(() => void refreshChart(), OPEN_TRADE_CHART_REFRESH_MS) : null;
    const quoteIntervalId = isOpen
      ? window.setInterval(() => void refreshLiveQuote(), PROJECTX_LIVE_QUOTE_REFRESH_MS)
      : null;
    return () => {
      controller.abort();
      if (intervalId !== null) window.clearInterval(intervalId);
      if (quoteIntervalId !== null) window.clearInterval(quoteIntervalId);
    };
  }, [
    activeTrade?.entryIndex,
    activeTrade?.entryTime,
    activeTrade?.exitIndex,
    activeTrade?.exitTime,
    activeTrade?.id,
    activeTrade?.market,
    activeTrade?.isOpen,
    activeTrade?.sourceTimeframe,
    activeTrade?.symbol,
    chartTimeframe
  ]);

  const chartNotice =
    chartState.fallback && chartState.requestedTimeframe && chartState.timeframe
      ? `This timeframe is unavailable. Showing ${chartState.timeframe}.`
      : undefined;
  const displayedChartTimeframe = chartState.fallback && chartState.timeframe ? chartState.timeframe : chartTimeframe;

  const activeTradeModal = activeTrade && activeDisplayTrade ? (
    <div
      className="tradeModalBackdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setActiveTradeId(null);
      }}
    >
      <section
        className={`tradeModal ${activeDisplayTrade.rowClassName}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${displaySymbol(activeDisplayTrade)} trade details`}
        onMouseDown={(event) => event.stopPropagation()}
        ref={modalRef}
      >
        <div className="tradeModalHead">
          <div className="tradeModalTitle">
            <strong>{isRestricted ? "Admin only" : activeDisplayTrade.modelName}</strong>
            <span title={displaySymbol(activeDisplayTrade) !== activeDisplayTrade.symbol ? `Signal ${activeDisplayTrade.symbol}` : undefined}>
              {displaySymbol(activeDisplayTrade)} / {activeDisplayTrade.marketLabel}
            </span>
          </div>
          <div className="tradeModalHeadActions">
            <button type="button" className="tradeModalCloseButton" aria-label="Close trade details" title="Close" onClick={() => setActiveTradeId(null)} ref={closeButtonRef}>
              <span aria-hidden="true">X</span>
            </button>
          </div>
        </div>

        <div className="tradeModalBody">
          <div className="tradeModalMetrics four">
            <InfoBox label="Entry Reason" value={`Model: ${isRestricted ? "Admin only" : activeDisplayTrade.modelName}`} tone="blue" />
            <InfoBox label="Entry Price" value={activeDisplayTrade.entryPriceLabel} />
            <InfoBox label="Exit Reason" value={displayExitReasonLabel(activeDisplayTrade)} tone="blue" />
            <InfoBox label={activeDisplayTrade.isOpen ? "Current Mark" : "Exit Price"} value={activeDisplayTrade.exitPriceLabel} />
          </div>

          <div className="tradeModalMetrics six">
            <InfoBox label={activeDisplayTrade.isEstimatedPnl ? "Estimated PnL" : "PnL"} value={activeDisplayTrade.pnlLabel} valueClassName={activeDisplayTrade.pnlClassName} tone={activeDisplayTrade.pnlClassName === "up" ? "green" : activeDisplayTrade.pnlClassName === "down" ? "red" : "neutral"} />
            <InfoBox label="Duration" value={activeDurationLabel} />
            <InfoBox label="Take Profit" value={`${activeDisplayTrade.targetPriceLabel} / ${activeDisplayTrade.targetLabel}`} tone="green" />
            <InfoBox label="Stop Loss" value={`${activeDisplayTrade.stopPriceLabel} / ${activeDisplayTrade.riskLabel}`} tone="red" />
            <InfoBox label="Peak (MFE)" value={activeStats.mfe == null ? "--" : formatSignedMoney(activeStats.mfe)} tone="green" />
            <InfoBox label="DD (MAE)" value={activeStats.mae == null ? "--" : formatLossMoney(activeStats.mae)} tone="red" />
          </div>

          <TradePriceChart
            bars={chartState.bars}
            dataTimeframe={chartState.timeframe ?? chartTimeframe}
            emptyMessage={chartState.message}
            notice={chartNotice}
            onTimeframeChange={setChartTimeframe}
            replayBars={chartState.replayBars}
            replayTimeframe={chartState.replayTimeframe}
            status={chartState.status}
            timeframe={displayedChartTimeframe}
            timeframes={TRADE_CHART_TIMEFRAMES}
            trade={activeChartTrade ?? activeTrade}
          />
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <div className="terminal-table-wrap tall historyScroll">
        <table className="terminal-table history-table">
          <colgroup>
            <col className="history-col-index" />
            <col className="history-col-ticker" />
            <col className="history-col-model" />
            <col className="history-col-direction" />
            <col className="history-col-price" />
            <col className="history-col-price" />
            <col className="history-col-duration" />
            <col className="history-col-exit" />
            <col className="history-col-pnl" />
            <col className="history-col-rmultiple" />
            <col className="history-col-size" />
            <col className="history-col-target" />
            <col className="history-col-stop" />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Ticker</th>
              <th>Entry model</th>
              <th>Direction</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Duration</th>
              <th>Exit by</th>
              <th>P&L $</th>
              <th>R</th>
              <th>Size</th>
              <th>Take Profit $</th>
              <th>Stop Loss $</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((trade) => {
              const displayedModelName = isRestricted ? "Admin only" : trade.modelName;
              const exitReasonLabel = displayExitReasonLabel(trade);
              const visibleSymbol = displaySymbol(trade);
              return (
                <tr
                  className={`historyTradeRow ${trade.rowClassName}`}
                  key={trade.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${visibleSymbol} trade details`}
                  onClick={(event) => openTrade(trade, event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openTrade(trade, event.currentTarget);
                    }
                  }}
                >
                  <td data-label="#">{trade.indexLabel}</td>
                  <td className="ticker-cell" data-label="Ticker" title={visibleSymbol !== trade.symbol ? `Signal ${trade.symbol}` : undefined}>
                    {visibleSymbol}
                  </td>
                  <td className="main-cell" data-label="Entry model">
                    <span className={isRestricted ? "adminOnlyMaskedText" : undefined}>{displayedModelName}</span>
                    <small>{isRestricted ? "Click to view trade" : <LocalDateTime value={trade.entryTime} />}</small>
                  </td>
                  <td data-label="Direction">
                    <span className={trade.sideClassName}>{trade.sideLabel}</span>
                  </td>
                  <td data-label="Entry">{trade.entryPriceLabel}</td>
                  <td data-label={trade.isOpen ? "Mark" : "Exit"}>{trade.exitPriceLabel}</td>
                  <td data-label="Duration">
                    {trade.durationLabel} <span className="durationDetail">/ {trade.durationDetailLabel}</span>
                  </td>
                  <td data-label="Exit by">
                    <span className={exitReasonClassName(exitReasonLabel)}>{exitReasonLabel}</span>
                  </td>
                  <td className={trade.pnlClassName} data-label={trade.isEstimatedPnl ? "Est. P&L $" : "P&L $"}>
                    {trade.isEstimatedPnl ? `Est. ${trade.pnlLabel}` : trade.pnlLabel}
                  </td>
                  <td className={trade.pnlClassName} data-label="R">{trade.rMultipleLabel}</td>
                  <td data-label="Size">{trade.sizeLabel}</td>
                  <td className="take-profit-cell" data-label="Take Profit $">{trade.targetLabel}</td>
                  <td className="stop-loss-cell" data-label="Stop Loss $">{trade.riskLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {activeTradeModal ? createPortal(activeTradeModal, document.body) : null}
    </>
  );
}
