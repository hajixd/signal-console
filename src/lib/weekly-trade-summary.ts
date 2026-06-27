import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { autoTradeMarketForSignal, type AutoTradeMarket } from "@/lib/auto-trade-platforms";
import { plannedRiskSizeMultiplierForTrade } from "@/lib/auto-trade-utils";
import { firebaseDb, firebaseLocalFallbackEnabled, hasFirebaseAdmin, withFirebaseTimeout } from "@/lib/firebase-admin";
import { omitUndefinedDeep } from "@/lib/firestore-utils";
import { createTursoDocument, getTursoDocument, saveTursoDocument, tursoConfigured } from "@/lib/turso";
import {
  addCalendarDays,
  formatLocalDateKey,
  formatPacificTime,
  PACIFIC_TIME_ZONE,
  zonedDateTimeToUtc,
  zonedParts
} from "@/lib/market-schedule";
import { dollarPerUnit } from "@/lib/instruments";
import { combinedNotificationError, combinedNotificationStatus, sendTextNotification } from "@/lib/notifications";
import { getTrades } from "@/lib/storage";
import type { NotificationStatus, TradeAlert } from "@/lib/types";

type TradeSummaryMarker = {
  claimedAt?: string;
  completedAt?: string;
  discordError?: string;
  discordStatus?: NotificationStatus;
  key: string;
  markerStatus?: "claimed" | "completed";
  market: AutoTradeMarket;
  period: "daily" | "weekly";
  sentAt: string;
  telegramError?: string;
  telegramStatus: NotificationStatus;
  tradingDateKey?: string;
  weekKey?: string;
};

type WeeklySummaryWindow = {
  end: Date;
  market: AutoTradeMarket;
  sessionClock: string;
  start: Date;
  weekKey: string;
};

type DailySummaryWindow = {
  end: Date;
  market: AutoTradeMarket;
  sessionClock: string;
  start: Date;
  tradingDateKey: string;
};

export type WeeklySummaryRunResult = {
  checkedAt: string;
  due: boolean;
  reason?: string;
  sent: Array<{
    discordError?: string;
    discordStatus: NotificationStatus;
    error?: string;
    market: AutoTradeMarket;
    status: NotificationStatus;
    telegramError?: string;
    telegramStatus: NotificationStatus;
    tradeCount: number;
    weekKey: string;
  }>;
  skipped: Array<{
    market: AutoTradeMarket;
    reason: string;
    weekKey: string;
  }>;
};

export type DailySummaryRunResult = {
  checkedAt: string;
  sent: Array<{
    discordError?: string;
    discordStatus: NotificationStatus;
    error?: string;
    market: AutoTradeMarket;
    status: NotificationStatus;
    telegramError?: string;
    telegramStatus: NotificationStatus;
    tradeCount: number;
    tradingDateKey: string;
  }>;
  skipped: Array<{
    market: AutoTradeMarket;
    reason: string;
    tradingDateKey?: string;
  }>;
};

const WEEKLY_SUMMARY_COLLECTION = "signalConsoleWeeklySummaries";
const DAILY_SUMMARY_COLLECTION = "signalConsoleDailySummaries";
const LOCAL_RUNTIME_ROOT = process.env.VERCEL === "1" ? path.join(tmpdir(), "signal-console") : path.join(/*turbopackIgnore: true*/ process.cwd(), ".local");
const LOCAL_WEEKLY_SUMMARY_PATH = path.join(LOCAL_RUNTIME_ROOT, "signal-console-weekly-summaries.json");
const LOCAL_DAILY_SUMMARY_PATH = path.join(LOCAL_RUNTIME_ROOT, "signal-console-daily-summaries.json");
const SUMMARY_MARKETS: AutoTradeMarket[] = ["forex", "futures"];
const MAX_TRADE_LINES = 8;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatMoney(value: number, signed = false): string {
  const formatted = new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    style: "currency"
  }).format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "inf";
  if (!Number.isFinite(value)) return "∞";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function formatPct(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    style: "percent"
  }).format(value);
}

function summaryTitle(title: string): string {
  return `<b>${escapeHtml(title)}</b>`;
}

function weeklyMarkerKey(market: AutoTradeMarket, weekKey: string): string {
  return `${weekKey}-${market}`;
}

function dailyMarkerKey(market: AutoTradeMarket, tradingDateKey: string): string {
  return `daily-${tradingDateKey}-${market}`;
}

async function readLocalMarkers(filePath: string): Promise<Record<string, TradeSummaryMarker>> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, TradeSummaryMarker>;
  } catch {
    return {};
  }
}

async function writeLocalMarkers(filePath: string, markers: Record<string, TradeSummaryMarker>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(markers, null, 2));
}

async function saveMarker(collection: string, localPath: string, marker: TradeSummaryMarker): Promise<void> {
  const payload = omitUndefinedDeep(marker);
  if (tursoConfigured()) {
    try {
      await saveTursoDocument({
        collection,
        id: marker.key,
        payload,
        sortTimeMillis: Date.parse(marker.sentAt)
      });
      return;
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb()
          .collection(collection)
          .doc(marker.key)
          .set({
            ...payload,
            updatedAtServer: FieldValue.serverTimestamp()
          }),
        "Firebase trade summary marker write"
      );
      return;
    } catch (error) {
      if (process.env.VERCEL === "1") throw error;
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Firebase Admin is required for production trade summary markers.");
  }

  const markers = await readLocalMarkers(localPath);
  await writeLocalMarkers(localPath, {
    ...markers,
    [marker.key]: marker
  });
}

async function claimMarker(collection: string, localPath: string, marker: TradeSummaryMarker): Promise<TradeSummaryMarker | null> {
  const claimedMarker: TradeSummaryMarker = {
    ...marker,
    claimedAt: marker.sentAt,
    discordStatus: "skipped",
    markerStatus: "claimed",
    telegramStatus: "skipped"
  };

  if (tursoConfigured()) {
    try {
      const created = await createTursoDocument({
        collection,
        id: marker.key,
        payload: omitUndefinedDeep(claimedMarker),
        sortTimeMillis: Date.parse(marker.sentAt)
      });
      if (created) return null;
      const existing = await getTursoDocument(collection, marker.key);
      return existing?.payload as TradeSummaryMarker | null;
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    const db = firebaseDb();
    const doc = db.collection(collection).doc(marker.key);
    try {
      return await withFirebaseTimeout(
        db.runTransaction(async (transaction) => {
          const existing = await transaction.get(doc);
          if (existing.exists) return existing.data() as TradeSummaryMarker;
          transaction.create(doc, {
            ...omitUndefinedDeep(claimedMarker),
            updatedAtServer: FieldValue.serverTimestamp()
          });
          return null;
        }),
        "Firebase trade summary marker claim"
      );
    } catch (error) {
      if (process.env.VERCEL === "1") throw error;
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }

  if (process.env.VERCEL === "1") {
    throw new Error("Firebase Admin is required to claim production trade summary markers.");
  }

  const markers = await readLocalMarkers(localPath);
  const existing = markers[marker.key];
  if (existing) return existing;
  await writeLocalMarkers(localPath, {
    ...markers,
    [marker.key]: claimedMarker
  });
  return null;
}

function markerStatusText(marker: TradeSummaryMarker): string {
  if (marker.markerStatus === "claimed") return "claimed";
  const channelStatuses = [marker.telegramStatus, marker.discordStatus].filter((status): status is NotificationStatus => Boolean(status));
  return channelStatuses.length ? channelStatuses.join("/") : "recorded";
}

function weeklySummaryDue(value: Date): { due: boolean; reason?: string; weekKey?: string } {
  const pacific = zonedParts(value, PACIFIC_TIME_ZONE);
  const minutes = pacific.hour * 60 + pacific.minute;
  if (pacific.weekday !== 5 || minutes < 15 * 60) {
    return {
      due: false,
      reason: "Weekly summaries are sent after the Friday 2:00-3:00 PM Pacific rollover window."
    };
  }
  return {
    due: true,
    weekKey: formatLocalDateKey(pacific)
  };
}

function summaryWindow(market: AutoTradeMarket, weekKey: string): WeeklySummaryWindow {
  const [yearText, monthText, dayText] = weekKey.split("-");
  const friday = {
    day: Number(dayText),
    month: Number(monthText),
    year: Number(yearText)
  };
  const sunday = addCalendarDays(friday, -5);

  if (market === "forex") {
    return {
      end: zonedDateTimeToUtc({ ...friday, hour: 14, minute: 0 }, PACIFIC_TIME_ZONE),
      market,
      sessionClock: "Forex practical week: Sunday 3:00 PM to Friday 2:00 PM Pacific, with daily 2:00-3:00 PM rollover windows",
      start: zonedDateTimeToUtc({ ...sunday, hour: 15, minute: 0 }, PACIFIC_TIME_ZONE),
      weekKey
    };
  }

  return {
    end: zonedDateTimeToUtc({ ...friday, hour: 14, minute: 0 }, PACIFIC_TIME_ZONE),
    market,
    sessionClock: "Futures summary week: Sunday 3:00 PM to Friday 2:00 PM Pacific, after the daily 2:00-3:00 PM CME maintenance window",
    start: zonedDateTimeToUtc({ ...sunday, hour: 15, minute: 0 }, PACIFIC_TIME_ZONE),
    weekKey
  };
}

function dailySummaryWindow(market: AutoTradeMarket, tradingDateKey: string): DailySummaryWindow {
  const [yearText, monthText, dayText] = tradingDateKey.split("-");
  const closeDate = {
    day: Number(dayText),
    month: Number(monthText),
    year: Number(yearText)
  };
  const openDate = addCalendarDays(closeDate, -1);

  if (market === "forex") {
    return {
      end: zonedDateTimeToUtc({ ...closeDate, hour: 14, minute: 0 }, PACIFIC_TIME_ZONE),
      market,
      sessionClock: "Forex practical trading day: 3:00 PM to 2:00 PM Pacific, then the 2:00-3:00 PM rollover window",
      start: zonedDateTimeToUtc({ ...openDate, hour: 15, minute: 0 }, PACIFIC_TIME_ZONE),
      tradingDateKey
    };
  }

  return {
    end: zonedDateTimeToUtc({ ...closeDate, hour: 14, minute: 0 }, PACIFIC_TIME_ZONE),
    market,
    sessionClock: "Futures summary day: 3:00 PM to 2:00 PM Pacific, then the 2:00-3:00 PM CME maintenance window",
    start: zonedDateTimeToUtc({ ...openDate, hour: 15, minute: 0 }, PACIFIC_TIME_ZONE),
    tradingDateKey
  };
}

function dailySummaryDueForMarket(market: AutoTradeMarket, value: Date): { due: boolean; reason?: string; tradingDateKey?: string } {
  const parts = zonedParts(value, PACIFIC_TIME_ZONE);
  const minutes = parts.hour * 60 + parts.minute;
  const tradingDateKey = formatLocalDateKey(parts);

  if (market === "forex") {
    const weekdayClose = parts.weekday >= 1 && parts.weekday <= 4 && minutes >= 15 * 60;
    const fridayClose = parts.weekday === 5 && minutes >= 15 * 60;
    return weekdayClose || fridayClose
      ? { due: true, tradingDateKey }
      : {
          due: false,
          reason: "Forex daily summaries send after the 2:00-3:00 PM Pacific rollover window."
        };
  }

  const weekdayClose = parts.weekday >= 1 && parts.weekday <= 4 && minutes >= 15 * 60;
  const fridayClose = parts.weekday === 5 && minutes >= 15 * 60;
  return weekdayClose || fridayClose
    ? { due: true, tradingDateKey }
    : {
        due: false,
        reason: "Futures daily summaries send after the 2:00-3:00 PM Pacific CME maintenance window."
      };
}

export function dueDailySummaryWindows(value = new Date()): DailySummaryWindow[] {
  return SUMMARY_MARKETS.flatMap((market) => {
    const due = dailySummaryDueForMarket(market, value);
    return due.due && due.tradingDateKey ? [dailySummaryWindow(market, due.tradingDateKey)] : [];
  });
}

function tradeMarket(trade: TradeAlert): AutoTradeMarket | null {
  return autoTradeMarketForSignal(trade.market);
}

function tradeTime(trade: TradeAlert): number {
  const parsed = Date.parse(trade.signalTime);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tradeRiskDollars(trade: TradeAlert): number {
  return Math.abs(trade.slUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * plannedRiskSizeMultiplierForTrade(trade));
}

function tradePnl(trade: TradeAlert): number | undefined {
  const placedOrders = (trade.autoTradeOrders ?? []).filter((order) => order.status === "placed");
  const orderPnl = placedOrders
    .map((order) => order.netPnlDollars)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (placedOrders.length > 0 && orderPnl.length === placedOrders.length) return orderPnl.reduce((sum, value) => sum + value, 0);
  return typeof trade.lifecyclePnlDollars === "number" && Number.isFinite(trade.lifecyclePnlDollars)
    ? trade.lifecyclePnlDollars
    : undefined;
}

function tradeRMultiple(trade: TradeAlert): number | undefined {
  return typeof trade.lifecycleRMultiple === "number" && Number.isFinite(trade.lifecycleRMultiple)
    ? trade.lifecycleRMultiple
    : undefined;
}

function outcomeLabel(trade: TradeAlert): string {
  if (trade.lifecycleStatus === "take_profit") return "TP";
  if (trade.lifecycleStatus === "stop_loss") return "SL";
  if (trade.lifecycleStatus === "max_bars") return "Max bars";
  return "Open";
}

function executionLabel(trade: TradeAlert): string {
  if (trade.autoTradeOrders?.some((order) => order.status === "placed")) return "placed";
  if (trade.autoTradeOrders?.some((order) => order.status === "dry_run")) return "dry run";
  if (trade.autoTradeOrders?.some((order) => order.status === "failed")) return "failed";
  if (trade.autoTradeStatus) return trade.autoTradeStatus.replaceAll("_", " ");
  return "alert";
}

function marketTitle(market: AutoTradeMarket): string {
  return market === "forex" ? "Forex" : "Futures";
}

function sideLabel(trade: TradeAlert): string {
  return trade.side === "long" ? "BUY" : "SELL";
}

function shortTradeLabel(trade: TradeAlert): string {
  const pnl = tradePnl(trade);
  const r = tradeRMultiple(trade);
  return [
    `- ${trade.symbol} ${sideLabel(trade)}`,
    outcomeLabel(trade),
    pnl !== undefined ? formatMoney(pnl, true) : `risk ${formatMoney(tradeRiskDollars(trade))}`,
    r !== undefined ? `${formatNumber(r)}R` : undefined
  ]
    .filter((part): part is string => Boolean(part))
    .join(" | ");
}

function symbolBreakdownLines(trades: TradeAlert[]): string[] {
  const groups = new Map<string, { closed: number; net: number; total: number }>();
  for (const trade of trades) {
    const pnl = tradePnl(trade);
    const current = groups.get(trade.symbol) ?? { closed: 0, net: 0, total: 0 };
    current.total += 1;
    if (pnl !== undefined) {
      current.closed += 1;
      current.net += pnl;
    }
    groups.set(trade.symbol, current);
  }

  return [...groups.entries()]
    .sort((left, right) => Math.abs(right[1].net) - Math.abs(left[1].net) || right[1].total - left[1].total)
    .slice(0, 4)
    .map(([symbol, group]) => `${symbol} ${formatMoney(group.net, true)} (${group.closed}/${group.total})`);
}

function executionSummaryLines(trades: TradeAlert[]): string[] {
  const counts = new Map<string, number>();
  for (const trade of trades) {
    const label = executionLabel(trade);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => `${count} ${label}`);
}

function formatTradeSummaryMessage(
  market: AutoTradeMarket,
  fields: {
    dateLabel: string;
    emptyTradeText: string;
    title: string;
    windowEnd: Date;
    windowStart: Date;
  },
  trades: TradeAlert[]
): string {
  const closedTrades = trades.filter((trade) => tradePnl(trade) !== undefined);
  const openTrades = trades.filter((trade) => tradePnl(trade) === undefined);
  const pnls = closedTrades.map((trade) => tradePnl(trade)!);
  const netPnl = pnls.reduce((sum, value) => sum + value, 0);
  const grossWins = pnls.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losingPnls = pnls.filter((value) => value < 0);
  const grossLosses = Math.abs(losingPnls.reduce((sum, value) => sum + value, 0));
  const winners = pnls.filter((value) => value > 0).length;
  const winRate = closedTrades.length ? winners / closedTrades.length : 0;
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Number.POSITIVE_INFINITY : 0;
  const averageWin = winners ? grossWins / winners : 0;
  const averageLoss = losingPnls.length ? losingPnls.reduce((sum, value) => sum + value, 0) / losingPnls.length : 0;
  const openRisk = openTrades.reduce((sum, trade) => sum + tradeRiskDollars(trade), 0);
  const takeProfits = trades.filter((trade) => trade.lifecycleStatus === "take_profit").length;
  const stopLosses = trades.filter((trade) => trade.lifecycleStatus === "stop_loss").length;
  const maxBars = trades.filter((trade) => trade.lifecycleStatus === "max_bars").length;
  const tradeLines = [...trades]
    .sort((left, right) => tradeTime(right) - tradeTime(left))
    .slice(0, MAX_TRADE_LINES)
    .map(shortTradeLabel);
  const hiddenTradeCount = Math.max(0, trades.length - tradeLines.length);
  const symbolLines = symbolBreakdownLines(trades);
  const executionLines = executionSummaryLines(trades);
  const executionSummary = executionLines.length ? executionLines.join(", ") : "none";
  const symbolSummary = symbolLines.length ? symbolLines.join(", ") : undefined;
  const lines = [
    summaryTitle(`${marketTitle(market)} ${fields.title}`),
    `<b>${escapeHtml(fields.dateLabel)}</b>`,
    `Trades ${trades.length} | Closed ${closedTrades.length} | Open ${openTrades.length} | Net <b>${formatMoney(netPnl, true)}</b>`,
    `WR ${formatPct(winRate)} | PF ${formatNumber(profitFactor)} | Avg ${formatMoney(averageWin, true)}/${formatMoney(averageLoss, true)}`,
    `TP/SL/MB ${takeProfits}/${stopLosses}/${maxBars}${openTrades.length ? ` | Open risk ${formatMoney(openRisk)}` : ""}`,
    `Exec ${escapeHtml(executionSummary)}`,
    symbolSummary ? `Symbols ${escapeHtml(symbolSummary)}` : undefined,
    `<b>Recent:</b>`,
    ...(tradeLines.length ? tradeLines.map(escapeHtml) : [fields.emptyTradeText]),
    hiddenTradeCount ? `...and ${hiddenTradeCount} more.` : undefined
  ];

  return lines.filter((line): line is string => line !== undefined).join("\n");
}

export function formatWeeklySummaryMessage(market: AutoTradeMarket, window: WeeklySummaryWindow, trades: TradeAlert[]): string {
  return formatTradeSummaryMessage(
    market,
    {
      dateLabel: `Week ending ${window.weekKey}`,
      emptyTradeText: "No trades this week.",
      title: "Weekly",
      windowEnd: window.end,
      windowStart: window.start
    },
    trades
  );
}

export function formatDailySummaryMessage(market: AutoTradeMarket, window: DailySummaryWindow, trades: TradeAlert[]): string {
  return formatTradeSummaryMessage(
    market,
    {
      dateLabel: `Trading day ${window.tradingDateKey}`,
      emptyTradeText: "No trades today.",
      title: "Daily",
      windowEnd: window.end,
      windowStart: window.start
    },
    trades
  );
}

function tradesForWindow(trades: TradeAlert[], market: AutoTradeMarket, window: Pick<WeeklySummaryWindow | DailySummaryWindow, "end" | "start">): TradeAlert[] {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  return trades.filter((trade) => {
    const timestamp = tradeTime(trade);
    return trade.status === "alerted" && tradeMarket(trade) === market && timestamp >= startMs && timestamp <= endMs;
  });
}

export async function sendDueWeeklyTradeSummaries(value = new Date()): Promise<WeeklySummaryRunResult> {
  const due = weeklySummaryDue(value);
  const result: WeeklySummaryRunResult = {
    checkedAt: value.toISOString(),
    due: due.due,
    reason: due.reason,
    sent: [],
    skipped: []
  };
  if (!due.due || !due.weekKey) return result;

  let trades: TradeAlert[] | null = null;
  for (const market of SUMMARY_MARKETS) {
    const key = weeklyMarkerKey(market, due.weekKey);
    const existing = await claimMarker(WEEKLY_SUMMARY_COLLECTION, LOCAL_WEEKLY_SUMMARY_PATH, {
      key,
      market,
      period: "weekly",
      sentAt: value.toISOString(),
      telegramStatus: "skipped",
      weekKey: due.weekKey
    });
    if (existing) {
      result.skipped.push({
        market,
        reason: `Weekly ${market} summary already ${markerStatusText(existing)} at ${existing.completedAt ?? existing.sentAt}.`,
        weekKey: due.weekKey
      });
      continue;
    }

    const window = summaryWindow(market, due.weekKey);
    trades ??= await getTrades();
    const marketTrades = tradesForWindow(trades, market, window);
    const notification = await sendTextNotification(formatWeeklySummaryMessage(market, window, marketTrades));
    const status = combinedNotificationStatus(notification);
    result.sent.push({
      discordError: notification.discord.error,
      discordStatus: notification.discord.status,
      error: combinedNotificationError(notification),
      market,
      status,
      telegramError: notification.telegram.error,
      telegramStatus: notification.telegram.status,
      tradeCount: marketTrades.length,
      weekKey: due.weekKey
    });

    await saveMarker(WEEKLY_SUMMARY_COLLECTION, LOCAL_WEEKLY_SUMMARY_PATH, {
      claimedAt: value.toISOString(),
      completedAt: new Date().toISOString(),
      discordError: notification.discord.error,
      discordStatus: notification.discord.status,
      key,
      markerStatus: "completed",
      market,
      period: "weekly",
      sentAt: value.toISOString(),
      telegramError: notification.telegram.error,
      telegramStatus: notification.telegram.status,
      weekKey: due.weekKey
    });
  }

  return result;
}

export async function sendDueDailyTradeSummaries(value = new Date()): Promise<DailySummaryRunResult> {
  const result: DailySummaryRunResult = {
    checkedAt: value.toISOString(),
    sent: [],
    skipped: []
  };

  const windows = dueDailySummaryWindows(value);
  const windowByMarket = new Map(windows.map((window) => [window.market, window]));
  for (const market of SUMMARY_MARKETS) {
    const window = windowByMarket.get(market);
    if (!window) {
      result.skipped.push({
        market,
        reason: dailySummaryDueForMarket(market, value).reason ?? "Daily summary is not due yet."
      });
    }
  }
  if (!windows.length) return result;

  let trades: TradeAlert[] | null = null;
  for (const window of windows) {
    const key = dailyMarkerKey(window.market, window.tradingDateKey);
    const existing = await claimMarker(DAILY_SUMMARY_COLLECTION, LOCAL_DAILY_SUMMARY_PATH, {
      key,
      market: window.market,
      period: "daily",
      sentAt: value.toISOString(),
      telegramStatus: "skipped",
      tradingDateKey: window.tradingDateKey
    });
    if (existing) {
      result.skipped.push({
        market: window.market,
        reason: `Daily ${window.market} summary already ${markerStatusText(existing)} at ${existing.completedAt ?? existing.sentAt}.`,
        tradingDateKey: window.tradingDateKey
      });
      continue;
    }

    trades ??= await getTrades();
    const marketTrades = tradesForWindow(trades, window.market, window);
    const notification = await sendTextNotification(formatDailySummaryMessage(window.market, window, marketTrades));
    const status = combinedNotificationStatus(notification);
    result.sent.push({
      discordError: notification.discord.error,
      discordStatus: notification.discord.status,
      error: combinedNotificationError(notification),
      market: window.market,
      status,
      telegramError: notification.telegram.error,
      telegramStatus: notification.telegram.status,
      tradeCount: marketTrades.length,
      tradingDateKey: window.tradingDateKey
    });

    await saveMarker(DAILY_SUMMARY_COLLECTION, LOCAL_DAILY_SUMMARY_PATH, {
      claimedAt: value.toISOString(),
      completedAt: new Date().toISOString(),
      discordError: notification.discord.error,
      discordStatus: notification.discord.status,
      key,
      markerStatus: "completed",
      market: window.market,
      period: "daily",
      sentAt: value.toISOString(),
      telegramError: notification.telegram.error,
      telegramStatus: notification.telegram.status,
      tradingDateKey: window.tradingDateKey
    });
  }

  return result;
}
