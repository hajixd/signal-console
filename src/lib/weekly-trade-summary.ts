import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { autoTradeMarketForSignal, type AutoTradeMarket } from "@/lib/auto-trade-platforms";
import { firebaseDb, firebaseLocalFallbackEnabled, hasFirebaseAdmin, withFirebaseTimeout } from "@/lib/firebase-admin";
import { omitUndefinedDeep } from "@/lib/firestore-utils";
import {
  addCalendarDays,
  CHICAGO_TIME_ZONE,
  formatLocalDateKey,
  formatPacificTime,
  NEW_YORK_TIME_ZONE,
  PACIFIC_TIME_ZONE,
  zonedDateTimeToUtc,
  zonedParts
} from "@/lib/market-schedule";
import { dollarPerUnit } from "@/lib/instruments";
import { sendTelegramText } from "@/lib/telegram";
import { getTrades } from "@/lib/storage";
import type { TradeAlert } from "@/lib/types";

type WeeklySummaryMarker = {
  key: string;
  market: AutoTradeMarket;
  sentAt: string;
  telegramError?: string;
  telegramStatus: "sent" | "skipped";
  weekKey: string;
};

type WeeklySummaryWindow = {
  end: Date;
  market: AutoTradeMarket;
  sessionClock: string;
  start: Date;
  weekKey: string;
};

export type WeeklySummaryRunResult = {
  checkedAt: string;
  due: boolean;
  reason?: string;
  sent: Array<{
    error?: string;
    market: AutoTradeMarket;
    status: "sent" | "skipped" | "failed";
    tradeCount: number;
    weekKey: string;
  }>;
  skipped: Array<{
    market: AutoTradeMarket;
    reason: string;
    weekKey: string;
  }>;
};

const WEEKLY_SUMMARY_COLLECTION = "signalConsoleWeeklySummaries";
const LOCAL_RUNTIME_ROOT = process.env.VERCEL === "1" ? path.join(tmpdir(), "signal-console") : path.join(/*turbopackIgnore: true*/ process.cwd(), ".local");
const LOCAL_WEEKLY_SUMMARY_PATH = path.join(LOCAL_RUNTIME_ROOT, "signal-console-weekly-summaries.json");
const SUMMARY_MARKETS: AutoTradeMarket[] = ["forex", "futures"];
const MAX_TRADE_LINES = 14;

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

function markerKey(market: AutoTradeMarket, weekKey: string): string {
  return `${weekKey}-${market}`;
}

async function readLocalMarkers(): Promise<Record<string, WeeklySummaryMarker>> {
  try {
    return JSON.parse(await readFile(LOCAL_WEEKLY_SUMMARY_PATH, "utf8")) as Record<string, WeeklySummaryMarker>;
  } catch {
    return {};
  }
}

async function writeLocalMarkers(markers: Record<string, WeeklySummaryMarker>): Promise<void> {
  await mkdir(path.dirname(LOCAL_WEEKLY_SUMMARY_PATH), { recursive: true });
  await writeFile(LOCAL_WEEKLY_SUMMARY_PATH, JSON.stringify(markers, null, 2));
}

async function getMarker(key: string): Promise<WeeklySummaryMarker | null> {
  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(
        firebaseDb()
          .collection(WEEKLY_SUMMARY_COLLECTION)
          .doc(key)
          .get(),
        "Firebase weekly summary marker read"
      );
      return snapshot.exists ? (snapshot.data() as WeeklySummaryMarker) : null;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }

  return (await readLocalMarkers())[key] ?? null;
}

async function saveMarker(marker: WeeklySummaryMarker): Promise<void> {
  const payload = omitUndefinedDeep(marker);
  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb()
          .collection(WEEKLY_SUMMARY_COLLECTION)
          .doc(marker.key)
          .set({
            ...payload,
            updatedAtServer: FieldValue.serverTimestamp()
          }),
        "Firebase weekly summary marker write"
      );
      return;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }

  const markers = await readLocalMarkers();
  await writeLocalMarkers({
    ...markers,
    [marker.key]: marker
  });
}

function weeklySummaryDue(value: Date): { due: boolean; reason?: string; weekKey?: string } {
  const pacific = zonedParts(value, PACIFIC_TIME_ZONE);
  const minutes = pacific.hour * 60 + pacific.minute;
  if (pacific.weekday !== 5 || minutes < 14 * 60) {
    return {
      due: false,
      reason: "Weekly summaries are sent after the Friday market close in Pacific time."
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
      end: zonedDateTimeToUtc({ ...friday, hour: 16, minute: 59 }, NEW_YORK_TIME_ZONE),
      market,
      sessionClock: "Forex session: Sunday 5:05 PM to Friday 4:59 PM New York time",
      start: zonedDateTimeToUtc({ ...sunday, hour: 17, minute: 5 }, NEW_YORK_TIME_ZONE),
      weekKey
    };
  }

  return {
    end: zonedDateTimeToUtc({ ...friday, hour: 16, minute: 0 }, CHICAGO_TIME_ZONE),
    market,
    sessionClock: "Futures session: Sunday 5:00 PM to Friday 4:00 PM Chicago time",
    start: zonedDateTimeToUtc({ ...sunday, hour: 17, minute: 0 }, CHICAGO_TIME_ZONE),
    weekKey
  };
}

function tradeMarket(trade: TradeAlert): AutoTradeMarket | null {
  return autoTradeMarketForSignal(trade.market);
}

function tradeTime(trade: TradeAlert): number {
  const parsed = Date.parse(trade.signalTime);
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderSize(trade: TradeAlert): number | undefined {
  const sizes = (trade.autoTradeOrders ?? [])
    .filter((order) => order.status !== "skipped" && typeof order.size === "number" && Number.isFinite(order.size) && order.size > 0)
    .map((order) => order.size!);
  if (!sizes.length) return undefined;
  return sizes.reduce((sum, size) => sum + size, 0);
}

function tradeRiskDollars(trade: TradeAlert): number {
  return Math.abs(trade.slUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * (orderSize(trade) ?? trade.sizeMultiplier ?? 1));
}

function tradePnl(trade: TradeAlert): number | undefined {
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
  const strategy = truncate(trade.strategy.replace(/\s+/g, " "), 32);
  const pnl = tradePnl(trade);
  const r = tradeRMultiple(trade);
  return [
    `- ${formatPacificTime(new Date(tradeTime(trade)))}`,
    `${trade.symbol} ${sideLabel(trade)}`,
    outcomeLabel(trade),
    pnl !== undefined ? formatMoney(pnl, true) : `risk ${formatMoney(tradeRiskDollars(trade))}`,
    r !== undefined ? `${formatNumber(r)}R` : undefined,
    strategy
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
    .slice(0, 6)
    .map(([symbol, group]) => `- ${symbol}: ${formatMoney(group.net, true)} realized | ${group.closed}/${group.total} closed`);
}

function executionSummary(trades: TradeAlert[]): string {
  const counts = new Map<string, number>();
  for (const trade of trades) {
    const label = executionLabel(trade);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => `${count} ${label}`)
    .join(" | ");
}

function formatWeeklySummaryMessage(market: AutoTradeMarket, window: WeeklySummaryWindow, trades: TradeAlert[]): string {
  const closedTrades = trades.filter((trade) => tradePnl(trade) !== undefined);
  const openTrades = trades.filter((trade) => tradePnl(trade) === undefined);
  const pnls = closedTrades.map((trade) => tradePnl(trade)!);
  const netPnl = pnls.reduce((sum, value) => sum + value, 0);
  const grossWins = pnls.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLosses = pnls.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  const winners = pnls.filter((value) => value > 0).length;
  const winRate = closedTrades.length ? winners / closedTrades.length : 0;
  const rMultiples = closedTrades.map((trade) => tradeRMultiple(trade)).filter((value): value is number => value !== undefined);
  const avgR = rMultiples.length ? rMultiples.reduce((sum, value) => sum + value, 0) / rMultiples.length : 0;
  const openRisk = openTrades.reduce((sum, trade) => sum + tradeRiskDollars(trade), 0);
  const takeProfits = trades.filter((trade) => trade.lifecycleStatus === "take_profit").length;
  const stopLosses = trades.filter((trade) => trade.lifecycleStatus === "stop_loss").length;
  const maxBars = trades.filter((trade) => trade.lifecycleStatus === "max_bars").length;
  const bestTrade = closedTrades.sort((left, right) => (tradePnl(right) ?? 0) - (tradePnl(left) ?? 0))[0];
  const worstTrade = closedTrades.sort((left, right) => (tradePnl(left) ?? 0) - (tradePnl(right) ?? 0))[0];
  const tradeLines = trades
    .sort((left, right) => tradeTime(right) - tradeTime(left))
    .slice(0, MAX_TRADE_LINES)
    .map(shortTradeLabel);
  const hiddenTradeCount = Math.max(0, trades.length - tradeLines.length);
  const symbolLines = symbolBreakdownLines(trades);
  const lines = [
    `<b>${marketTitle(market)} Weekly Summary</b>`,
    `<b>Week ending ${escapeHtml(window.weekKey)}</b>`,
    `${escapeHtml(window.sessionClock)}`,
    `${escapeHtml(formatPacificTime(window.start))} to ${escapeHtml(formatPacificTime(window.end))}`,
    "",
    `<b>Scoreboard</b>`,
    `Trades: <b>${trades.length}</b> | Closed: <b>${closedTrades.length}</b> | Open: <b>${openTrades.length}</b>`,
    `Net P/L: <b>${formatMoney(netPnl, true)}</b> | Wins: ${formatMoney(grossWins, true)} | Losses: ${formatMoney(grossLosses, true)}`,
    `Win rate: <b>${formatPct(winRate)}</b> | Avg R: <b>${formatNumber(avgR)}R</b>`,
    `Outcomes: ${takeProfits} TP | ${stopLosses} SL | ${maxBars} max bars | ${openTrades.length} open`,
    openTrades.length ? `Open risk: ${formatMoney(openRisk)} estimated` : undefined,
    "",
    `<b>Execution</b>`,
    executionSummary(trades) || "No executions recorded",
    bestTrade || worstTrade ? "" : undefined,
    bestTrade ? `<b>Best</b>: ${escapeHtml(bestTrade.symbol)} ${formatMoney(tradePnl(bestTrade) ?? 0, true)} (${formatNumber(tradeRMultiple(bestTrade) ?? 0)}R)` : undefined,
    worstTrade ? `<b>Worst</b>: ${escapeHtml(worstTrade.symbol)} ${formatMoney(tradePnl(worstTrade) ?? 0, true)} (${formatNumber(tradeRMultiple(worstTrade) ?? 0)}R)` : undefined,
    symbolLines.length ? "" : undefined,
    symbolLines.length ? `<b>By Symbol</b>` : undefined,
    ...symbolLines.map(escapeHtml),
    "",
    `<b>Trades</b>`,
    tradeLines.length ? tradeLines.map(escapeHtml).join("\n") : "No trades were alerted for this market this week.",
    hiddenTradeCount ? `...and ${hiddenTradeCount} more.` : undefined,
    "",
    `<i>Realized P/L uses completed lifecycle outcomes; open trades are excluded from net P/L.</i>`
  ];

  return lines.filter((line): line is string => line !== undefined).join("\n");
}

function tradesForWindow(trades: TradeAlert[], market: AutoTradeMarket, window: WeeklySummaryWindow): TradeAlert[] {
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

  const trades = await getTrades();
  for (const market of SUMMARY_MARKETS) {
    const key = markerKey(market, due.weekKey);
    const existing = await getMarker(key);
    if (existing?.telegramStatus === "sent" || existing?.telegramStatus === "skipped") {
      result.skipped.push({
        market,
        reason: `Weekly ${market} summary already ${existing.telegramStatus} at ${existing.sentAt}.`,
        weekKey: due.weekKey
      });
      continue;
    }

    const window = summaryWindow(market, due.weekKey);
    const marketTrades = tradesForWindow(trades, market, window);
    const notification = await sendTelegramText(formatWeeklySummaryMessage(market, window, marketTrades));
    result.sent.push({
      error: notification.error,
      market,
      status: notification.status,
      tradeCount: marketTrades.length,
      weekKey: due.weekKey
    });

    if (notification.status !== "failed") {
      await saveMarker({
        key,
        market,
        sentAt: value.toISOString(),
        telegramError: notification.error,
        telegramStatus: notification.status,
        weekKey: due.weekKey
      });
    }
  }

  return result;
}
