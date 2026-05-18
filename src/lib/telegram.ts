import type { TradeAlert, TradeManagementEvent } from "./types";
import { dollarPerUnit, instrumentSizeLabel } from "./instruments";

const TELEGRAM_MAX_TEXT_LENGTH = 3900;
const TELEGRAM_SEND_TIMEOUT_MS = 10_000;

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 5
  }).format(value);
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatScale(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatMoney(value: number, signed = false): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  }).format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatSignalTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(new Date(value));
}

function formatEntryType(trade: TradeAlert): string {
  if (trade.entryType === "limit") return "Limit";
  if (trade.entryType === "market") return "Market";
  return truncate(trade.entryMode, 42) || "Signal";
}

function telegramGroupTitle(): string {
  return process.env.TELEGRAM_GROUP_TITLE?.trim() || "Trading Bot Alerts";
}

export function telegramGroupInviteLink(): string | undefined {
  return process.env.TELEGRAM_GROUP_INVITE_LINK?.trim() || process.env.TELEGRAM_GROUP_LINK?.trim();
}

function autoTradeLine(trade: TradeAlert): string {
  if (!trade.autoTradeStatus) return "";
  const provider = trade.autoTradeProviderName ?? trade.autoTradeOrders?.find((order) => order.providerName)?.providerName ?? "Auto trade";
  if (trade.autoTradeOrders?.length) {
    const placed = trade.autoTradeOrders.filter((order) => order.status === "placed").length;
    const dryRuns = trade.autoTradeOrders.filter((order) => order.status === "dry_run").length;
    const failed = trade.autoTradeOrders.filter((order) => order.status === "failed").length;
    const skipped = trade.autoTradeOrders.filter((order) => order.status === "skipped").length;
    const accountLabel = trade.autoTradeOrders
      .map((order) => order.accountName ?? String(order.accountId))
      .slice(0, 3)
      .join(", ");
    const suffix = trade.autoTradeOrders.length > 3 ? ` +${trade.autoTradeOrders.length - 3}` : "";
    const status = dryRuns
      ? `${dryRuns} dry run`
      : placed
        ? `${placed} placed${failed ? ` / ${failed} failed` : ""}${skipped ? ` / ${skipped} skipped` : ""}`
        : skipped && !failed
          ? `${skipped} skipped`
          : `${failed} failed${skipped ? ` / ${skipped} skipped` : ""}`;
    const issue = trade.autoTradeOrders.find((order) => (order.status === "failed" || order.status === "skipped") && order.error)?.error;
    return `${provider}: ${status} on ${accountLabel}${suffix} (${trade.autoTradeContractName ?? trade.autoTradeContractId ?? trade.symbol})${
      issue ? ` - ${truncate(issue, 180)}` : ""
    }`;
  }
  if (trade.autoTradeStatus === "placed") {
    return `${provider}: order ${trade.autoTradeOrderId ?? "placed"} on ${trade.autoTradeAccountName ?? trade.autoTradeAccountId ?? "account"} (${trade.autoTradeContractName ?? trade.autoTradeContractId ?? trade.symbol})`;
  }
  if (trade.autoTradeStatus === "dry_run") {
    return `${provider}: dry run for ${trade.autoTradeAccountName ?? trade.autoTradeAccountId ?? "account"} (${trade.autoTradeContractName ?? trade.autoTradeContractId ?? trade.symbol})`;
  }
  return `${provider}: ${trade.autoTradeStatus}${trade.autoTradeError ? ` - ${trade.autoTradeError}` : ""}`;
}

function fitTelegramMessage(text: string): string {
  if (text.length <= TELEGRAM_MAX_TEXT_LENGTH) return text;
  return `${text.slice(0, TELEGRAM_MAX_TEXT_LENGTH - 24)}\n\n[message truncated]`;
}

function joinTelegramLines(lines: Array<string | undefined>): string {
  return lines.filter((line): line is string => line !== undefined).join("\n");
}

export function formatTelegramMessage(trade: TradeAlert): string {
  const dollarUnit = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = trade.sizeMultiplier ?? 1;
  const rawSizeScale = trade.sizeScale;
  const sizeScale = typeof rawSizeScale === "number" && Number.isFinite(rawSizeScale) && rawSizeScale > 0 ? rawSizeScale : undefined;
  const targetDollars = Math.abs(trade.tpUnits * dollarUnit * sizeMultiplier);
  const riskDollars = Math.abs(trade.slUnits * dollarUnit * sizeMultiplier);
  const rewardRisk = riskDollars > 0 ? targetDollars / riskDollars : 0;
  const side = trade.side === "long" ? "BUY" : "SELL";
  const autoTrade = autoTradeLine(trade);
  const title = trade.entryType === "limit" ? "LIMIT ORDER" : "ENTRY SIGNAL";
  const lines = [
    `<b>${escapeHtml(telegramGroupTitle())}</b>`,
    `<b><u>${title}</u></b>`,
    `<b>${escapeHtml(trade.symbol)}</b> <u>${side}</u>`,
    "",
    `<b>Levels</b>`,
    `Entry <code>${formatPrice(trade.entryPrice)}</code> | ${escapeHtml(formatEntryType(trade))}`,
    `TP <code>${formatPrice(trade.takeProfitPrice)}</code> | <b>${formatMoney(targetDollars, true)}</b>`,
    `SL <code>${formatPrice(trade.stopLossPrice)}</code> | <b>${formatMoney(-riskDollars, true)}</b>`,
    `Size <code>${escapeHtml(instrumentSizeLabel(trade.symbol, sizeMultiplier))}</code>`,
    sizeScale && Math.abs(sizeScale - 1) > 0.005 ? `Scale: ${escapeHtml(formatScale(sizeScale))}x` : undefined,
    "",
    `<b>Edge</b>`,
    `Win <b>${formatNumber(trade.estimatedWinRatePct, 1)}%</b> | PF <b>${formatNumber(trade.liveProfitFactor)}</b> | RR <b>${formatNumber(rewardRisk)}R</b>`,
    autoTrade || trade.autoTradeError ? "" : undefined,
    autoTrade || trade.autoTradeError ? `<b>Execution</b>` : undefined,
    autoTrade ? escapeHtml(autoTrade) : undefined,
    trade.autoTradeError ? `<u>Execution note</u>: ${escapeHtml(truncate(trade.autoTradeError, 160))}` : undefined,
    `Signal <u>${escapeHtml(formatSignalTime(trade.signalTime))}</u>`
  ];
  return fitTelegramMessage(joinTelegramLines(lines));
}

export function formatTelegramOutcomeMessage(trade: TradeAlert): string {
  const outcome = trade.lifecycleStatus;
  const isTarget = outcome === "take_profit";
  const title = isTarget ? "Take Profit Hit" : outcome === "stop_loss" ? "Stop Loss Hit" : outcome === "max_bars" ? "Max Bars Exit" : "Trade Update";
  const pnl = trade.lifecyclePnlDollars;
  const rMultiple = trade.lifecycleRMultiple;
  const price = trade.lifecyclePrice;
  const time = trade.lifecycleTime;
  const side = trade.side === "long" ? "BUY" : "SELL";
  const lines = [
    `<b>${escapeHtml(telegramGroupTitle())}</b>`,
    `<b><u>${title.toUpperCase()}</u></b>`,
    `<b>${escapeHtml(trade.symbol)}</b> <u>${side}</u>`,
    "",
    `<b>Result</b>`,
    price !== undefined ? `Exit <code>${formatPrice(price)}</code>` : undefined,
    pnl !== undefined ? `P/L <b>${formatMoney(pnl, true)}</b>` : undefined,
    rMultiple !== undefined ? `R <b>${formatNumber(rMultiple)}R</b>` : undefined,
    time ? `Hit <u>${escapeHtml(formatSignalTime(time))}</u>` : undefined,
    "",
    `<b>Plan</b>`,
    `Entry <code>${formatPrice(trade.entryPrice)}</code>`,
    `TP <code>${formatPrice(trade.takeProfitPrice)}</code>`,
    `SL <code>${formatPrice(trade.stopLossPrice)}</code>`
  ];
  return fitTelegramMessage(joinTelegramLines(lines));
}

function managementEventTitle(event: TradeManagementEvent): string {
  if (event.type === "edit_tp") return "Edit TP";
  if (event.type === "edit_sl") return "Edit SL";
  return "Edit Limit Order";
}

export function formatTelegramManagementMessage(trade: TradeAlert, event: TradeManagementEvent): string {
  const side = trade.side === "long" ? "BUY" : "SELL";
  const previous = event.previousPrice !== undefined ? `Previous <code>${formatPrice(event.previousPrice)}</code>` : undefined;
  const reason = event.reason ? `Reason: ${escapeHtml(truncate(event.reason, 180))}` : undefined;
  const lines = [
    `<b>${escapeHtml(telegramGroupTitle())}</b>`,
    `<b><u>${managementEventTitle(event).toUpperCase()}</u></b>`,
    `<b>${escapeHtml(trade.symbol)}</b> <u>${side}</u>`,
    "",
    `<b>Updated Level</b>`,
    `New <code>${formatPrice(event.price)}</code>`,
    previous,
    reason,
    "",
    `<b>Current Plan</b>`,
    `Entry <code>${formatPrice(event.entryPrice ?? trade.entryPrice)}</code>`,
    `TP <code>${formatPrice(event.takeProfitPrice ?? (event.type === "edit_tp" ? event.price : trade.takeProfitPrice))}</code>`,
    `SL <code>${formatPrice(event.stopLossPrice ?? (event.type === "edit_sl" ? event.price : trade.stopLossPrice))}</code>`,
    `Event <u>${escapeHtml(formatSignalTime(event.time))}</u>`
  ];
  return fitTelegramMessage(joinTelegramLines(lines));
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && telegramChatId());
}

function telegramChatId(): string | undefined {
  return process.env.TELEGRAM_GROUP_CHAT_ID?.trim() || process.env.TELEGRAM_CHAT_ID?.trim();
}

export async function sendTelegramText(text: string): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = telegramChatId();
  if (!token || !chatId) return { status: "skipped" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_SEND_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text: fitTelegramMessage(text),
        disable_web_page_preview: true,
        parse_mode: "HTML"
      })
    });

    if (!response.ok) {
      return { status: "failed", error: `${response.status}: ${(await response.text()).slice(0, 240)}` };
    }
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Telegram request failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendTelegram(trade: TradeAlert): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  return sendTelegramText(formatTelegramMessage(trade));
}

export async function sendTelegramOutcome(trade: TradeAlert): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  return sendTelegramText(formatTelegramOutcomeMessage(trade));
}

export async function sendTelegramManagement(
  trade: TradeAlert,
  event: TradeManagementEvent
): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  return sendTelegramText(formatTelegramManagementMessage(trade, event));
}
