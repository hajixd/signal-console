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

export function formatTelegramMessage(trade: TradeAlert): string {
  const dollarUnit = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = trade.sizeMultiplier ?? 1;
  const targetDollars = Math.abs(trade.tpUnits * dollarUnit * sizeMultiplier);
  const riskDollars = Math.abs(trade.slUnits * dollarUnit * sizeMultiplier);
  const lines = [
    `New ${trade.symbol} ${trade.side.toUpperCase()} signal`,
    `${trade.strategy}`,
    ``,
    `Entry: ${formatPrice(trade.entryPrice)} (${trade.entryMode})`,
    `Take Profit: ${formatPrice(trade.takeProfitPrice)} (${trade.tpUnits} ${trade.unitLabel}, about ${formatMoney(targetDollars)})`,
    `Stop Loss: ${formatPrice(trade.stopLossPrice)} (${trade.slUnits} ${trade.unitLabel}, about ${formatMoney(riskDollars)})`,
    `Dollar size: ${instrumentSizeLabel(trade.symbol, sizeMultiplier)}`,
    `Estimated win odds: ${formatNumber(trade.estimatedWinRatePct, 1)}%`,
    `Live-style PF: ${formatNumber(trade.liveProfitFactor)}`,
    `Signal candle: ${trade.signalTime}`,
    `Alert id: ${trade.id}`
  ];
  if (trade.notes) lines.splice(9, 0, `Risk plan: ${trade.notes}`);
  return lines.join("\n");
}

export async function sendTelegram(trade: TradeAlert): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { status: "skipped" };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatTelegramMessage(trade),
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    return { status: "failed", error: `${response.status}: ${(await response.text()).slice(0, 240)}` };
  }
  return { status: "sent" };
}
