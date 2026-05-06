import type { TradeAlert } from "./types";
import { dollarPerUnit, instrumentSizeLabel } from "./instruments";

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
    .replace(/>/g, "&gt;");
}

function formatSignalTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

function autoTradeLine(trade: TradeAlert): string {
  if (!trade.autoTradeStatus) return "";
  if (trade.autoTradeStatus === "placed") {
    return `ProjectX: order ${trade.autoTradeOrderId ?? "placed"} on ${trade.autoTradeAccountName ?? trade.autoTradeAccountId ?? "account"} (${trade.autoTradeContractName ?? trade.autoTradeContractId ?? trade.symbol})`;
  }
  if (trade.autoTradeStatus === "dry_run") {
    return `ProjectX: dry run for ${trade.autoTradeAccountName ?? trade.autoTradeAccountId ?? "account"} (${trade.autoTradeContractName ?? trade.autoTradeContractId ?? trade.symbol})`;
  }
  return `ProjectX: ${trade.autoTradeStatus}${trade.autoTradeError ? ` - ${trade.autoTradeError}` : ""}`;
}

export function formatTelegramMessage(trade: TradeAlert): string {
  const dollarUnit = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = trade.sizeMultiplier ?? 1;
  const targetDollars = Math.abs(trade.tpUnits * dollarUnit * sizeMultiplier);
  const riskDollars = Math.abs(trade.slUnits * dollarUnit * sizeMultiplier);
  const rewardRisk = riskDollars > 0 ? targetDollars / riskDollars : 0;
  const executionModes = [trade.entryType, trade.tpMode, trade.slMode, trade.sizeMode].filter(Boolean).join(" / ");
  const side = trade.side === "long" ? "BUY" : "SELL";
  const lines = [
    `<b>${escapeHtml(trade.symbol)} ${side} signal</b>`,
    escapeHtml(trade.strategy),
    "",
    `<b>Entry</b>: ${formatPrice(trade.entryPrice)} (${escapeHtml(trade.entryMode)})`,
    `<b>Take Profit</b>: ${formatPrice(trade.takeProfitPrice)} / ${formatMoney(targetDollars)}`,
    `<b>Stop Loss</b>: ${formatPrice(trade.stopLossPrice)} / ${formatMoney(riskDollars)}`,
    `<b>Size</b>: ${escapeHtml(instrumentSizeLabel(trade.symbol, sizeMultiplier))}`,
    `<b>Stats</b>: ${formatNumber(trade.estimatedWinRatePct, 1)}% win odds / PF ${formatNumber(trade.liveProfitFactor)} / R:R ${formatNumber(rewardRisk)}`,
    executionModes ? `<b>Modes</b>: ${escapeHtml(executionModes)}` : "",
    autoTradeLine(trade) ? `<b>${escapeHtml(autoTradeLine(trade))}</b>` : "",
    trade.notes ? `<b>Risk note</b>: ${escapeHtml(trade.notes)}` : "",
    `<b>Signal candle</b>: ${escapeHtml(formatSignalTime(trade.signalTime))}`,
    `<code>${escapeHtml(trade.id)}</code>`
  ].filter(Boolean);
  return lines.join("\n");
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

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      parse_mode: "HTML"
    })
  });

  if (!response.ok) {
    return { status: "failed", error: `${response.status}: ${(await response.text()).slice(0, 240)}` };
  }
  return { status: "sent" };
}

export async function sendTelegram(trade: TradeAlert): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  return sendTelegramText(formatTelegramMessage(trade));
}
