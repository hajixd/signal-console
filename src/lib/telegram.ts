import type { TradeAlert } from "./types";
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

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  }).format(value);
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

function autoTradeLine(trade: TradeAlert): string {
  if (!trade.autoTradeStatus) return "";
  const provider = trade.autoTradeProviderName ?? trade.autoTradeOrders?.find((order) => order.providerName)?.providerName ?? "Auto trade";
  if (trade.autoTradeOrders?.length) {
    const placed = trade.autoTradeOrders.filter((order) => order.status === "placed").length;
    const dryRuns = trade.autoTradeOrders.filter((order) => order.status === "dry_run").length;
    const failed = trade.autoTradeOrders.filter((order) => order.status === "failed").length;
    const accountLabel = trade.autoTradeOrders
      .map((order) => order.accountName ?? String(order.accountId))
      .slice(0, 3)
      .join(", ");
    const suffix = trade.autoTradeOrders.length > 3 ? ` +${trade.autoTradeOrders.length - 3}` : "";
    const status = dryRuns ? `${dryRuns} dry run` : placed ? `${placed} placed${failed ? ` / ${failed} failed` : ""}` : `${failed} failed`;
    return `${provider}: ${status} on ${accountLabel}${suffix} (${trade.autoTradeContractName ?? trade.autoTradeContractId ?? trade.symbol})`;
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

export function formatTelegramMessage(trade: TradeAlert): string {
  const dollarUnit = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = trade.sizeMultiplier ?? 1;
  const targetDollars = Math.abs(trade.tpUnits * dollarUnit * sizeMultiplier);
  const riskDollars = Math.abs(trade.slUnits * dollarUnit * sizeMultiplier);
  const rewardRisk = riskDollars > 0 ? targetDollars / riskDollars : 0;
  const executionModes = [trade.entryType, trade.tpMode, trade.slMode, trade.sizeMode].filter(Boolean).join(" / ");
  const side = trade.side === "long" ? "BUY" : "SELL";
  const autoTrade = autoTradeLine(trade);
  const lines = [
    `<b>Signal</b>`,
    `${escapeHtml(trade.symbol)} ${side} | ${escapeHtml(truncate(trade.strategy, 120))}`,
    "",
    `<b>Plan</b>`,
    `Entry: ${formatPrice(trade.entryPrice)} (${escapeHtml(trade.entryMode)})`,
    `Take profit: ${formatPrice(trade.takeProfitPrice)} / ${formatMoney(targetDollars)}`,
    `Stop loss: ${formatPrice(trade.stopLossPrice)} / ${formatMoney(riskDollars)}`,
    `Size: ${escapeHtml(instrumentSizeLabel(trade.symbol, sizeMultiplier))}`,
    "",
    `<b>Stats</b>`,
    `Win odds: ${formatNumber(trade.estimatedWinRatePct, 1)}%`,
    `Profit factor: ${formatNumber(trade.liveProfitFactor)}`,
    `Reward/risk: ${formatNumber(rewardRisk)}R`,
    executionModes ? `Modes: ${escapeHtml(executionModes)}` : "",
    "",
    `<b>Execution</b>`,
    autoTrade ? escapeHtml(autoTrade) : "Auto trade: not attempted",
    trade.autoTradeError ? `Auto trade note: ${escapeHtml(truncate(trade.autoTradeError, 180))}` : "",
    trade.notes ? `Risk note: ${escapeHtml(truncate(trade.notes, 300))}` : "",
    "",
    `<b>Meta</b>`,
    `Signal candle: ${escapeHtml(formatSignalTime(trade.signalTime))}`,
    `<code>${escapeHtml(trade.id)}</code>`
  ].filter(Boolean);
  return fitTelegramMessage(lines.join("\n"));
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
