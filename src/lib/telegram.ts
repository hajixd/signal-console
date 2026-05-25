import type { TradeAlert, TradeManagementEvent } from "./types";
import { assetLookupSymbolForSymbol } from "./assets";
import { dollarPerUnit, instrumentSizeLabel } from "./instruments";

const TELEGRAM_MAX_TEXT_LENGTH = 3900;
const TELEGRAM_SEND_TIMEOUT_MS = 10_000;
const TELEGRAM_SEPARATOR = "-------------------------------------------------------";
const TELEGRAM_FALLBACK_TIME_ZONE = "America/Los_Angeles";

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

function telegramTimeZone(): string {
  const timeZone = process.env.TELEGRAM_TIME_ZONE?.trim() || TELEGRAM_FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return TELEGRAM_FALLBACK_TIME_ZONE;
  }
}

function formatSignalTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: telegramTimeZone(),
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

function compactAccountName(value: string | undefined, accountId: number): string {
  const label = value?.trim();
  if (!label) return `Account ${accountId}`;
  const fundedSize = label.match(/\b(50|100|150|200|250|300)\s*k\b/i)?.[0];
  return fundedSize ? fundedSize.toUpperCase().replace(/\s+/g, "") : label;
}

function orderStatusLabel(status: NonNullable<TradeAlert["autoTradeOrders"]>[number]["status"]): string {
  if (status === "dry_run") return "dry run";
  return status;
}

function autoTradeStatusLabel(status: TradeAlert["autoTradeStatus"]): string {
  if (!status) return "attention";
  if (status === "dry_run") return "dry run";
  return status.replaceAll("_", " ");
}

function formatOrderSize(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatTradePrice(value: number): string {
  return `${formatPrice(value)}$`;
}

function sizedOrders(orders: TradeAlert["autoTradeOrders"]): NonNullable<TradeAlert["autoTradeOrders"]> {
  return (orders ?? []).filter(
    (order) => order.status !== "skipped" && typeof order.size === "number" && Number.isFinite(order.size) && order.size > 0
  );
}

function autoTradeOrderSize(orders: TradeAlert["autoTradeOrders"]): number | undefined {
  const sizes = sizedOrders(orders).map((order) => order.size!);
  if (!sizes.length) return undefined;
  return sizes.reduce((sum, size) => sum + size, 0);
}

function telegramSizeLabel(trade: TradeAlert, instrumentLabel: string, fallbackSizeMultiplier: number): string {
  const orderSize = autoTradeOrderSize(trade.autoTradeOrders);
  const formattedOrderSize = formatOrderSize(orderSize);
  if (formattedOrderSize) return `${formattedOrderSize} ${instrumentLabel}`;
  const lookupSymbol = assetLookupSymbolForSymbol(trade.symbol);
  if (instrumentLabel !== trade.symbol && instrumentLabel !== lookupSymbol) {
    return `${formatOrderSize(fallbackSizeMultiplier) ?? formatNumber(fallbackSizeMultiplier)} ${instrumentLabel}`;
  }
  return instrumentSizeLabel(trade.symbol, fallbackSizeMultiplier);
}

function accountOrderLine(order: NonNullable<TradeAlert["autoTradeOrders"]>[number]): string {
  const formattedSize = formatOrderSize(order.size);
  const parts = [
    orderStatusLabel(order.status),
    typeof order.accountBalance === "number" && Number.isFinite(order.accountBalance) ? `Balance ${formatMoney(order.accountBalance)}` : undefined,
    formattedSize ? `Size ${formattedSize}` : undefined,
    order.orderId ? `Order ${order.orderId}` : undefined
  ].filter((part): part is string => Boolean(part));

  return `- ${compactAccountName(order.accountName, order.accountId)}: ${parts.join(" | ")}${
    order.error && order.status !== "failed" && order.status !== "skipped" ? ` | ${truncate(order.error, 120)}` : ""
  }`;
}

function accountGroupLabel(trade: TradeAlert): string {
  const label = trade.autoTradeAccountName?.trim();
  return label && !/^\d+\s+accounts?$/i.test(label) ? `${label} Accounts:` : "Accounts:";
}

function autoTradeLine(trade: TradeAlert): string {
  if (!trade.autoTradeStatus) return "";
  const provider = trade.autoTradeProviderName ?? trade.autoTradeOrders?.find((order) => order.providerName)?.providerName ?? "Auto trade";
  if (trade.autoTradeOrders?.length) {
    const placed = trade.autoTradeOrders.filter((order) => order.status === "placed").length;
    const dryRuns = trade.autoTradeOrders.filter((order) => order.status === "dry_run").length;
    const failed = trade.autoTradeOrders.filter((order) => order.status === "failed").length;
    const skipped = trade.autoTradeOrders.filter((order) => order.status === "skipped").length;
    const status = dryRuns
      ? `${dryRuns} dry run`
      : placed
        ? `${placed} placed${failed ? ` / ${failed} failed` : ""}${skipped ? ` / ${skipped} skipped` : ""}`
        : skipped && !failed
          ? `${skipped} skipped`
          : `${failed} failed${skipped ? ` / ${skipped} skipped` : ""}`;
    const issue = trade.autoTradeOrders.find((order) => (order.status === "failed" || order.status === "skipped") && order.error)?.error;
    return [
      `${provider}: ${status} (${trade.autoTradeContractName ?? trade.autoTradeContractId ?? trade.symbol})`,
      accountGroupLabel(trade),
      ...trade.autoTradeOrders.map(accountOrderLine),
      issue ? `Note: ${truncate(issue, 180)}` : undefined
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }
  if (trade.autoTradeStatus === "placed") {
    return `${provider}: order ${trade.autoTradeOrderId ?? "placed"} on ${trade.autoTradeAccountName ?? trade.autoTradeAccountId ?? "account"} (${trade.autoTradeContractName ?? trade.autoTradeContractId ?? trade.symbol})`;
  }
  if (trade.autoTradeStatus === "dry_run") {
    return `${provider}: dry run for ${trade.autoTradeAccountName ?? trade.autoTradeAccountId ?? "account"} (${trade.autoTradeContractName ?? trade.autoTradeContractId ?? trade.symbol})`;
  }
  return `${provider}: ${trade.autoTradeStatus}${trade.autoTradeError ? ` - ${trade.autoTradeError}` : ""}`;
}

function executionAccountParts(value: string | undefined, accountId: number): { name: string; size?: string } {
  const label = value?.trim();
  if (!label) return { name: `Account ${accountId}` };
  const fundedSize = label.match(/\b(50|100|150|200|250|300)\s*k\b/i)?.[0];
  const name = fundedSize
    ? label
        .replace(fundedSize, "")
        .replace(/[-|()[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : label;
  return {
    name: name || label,
    size: fundedSize?.toUpperCase().replace(/\s+/g, "")
  };
}

function accountExecutionRow(order: NonNullable<TradeAlert["autoTradeOrders"]>[number]): { line: string; name: string } {
  const formattedSize = formatOrderSize(order.size);
  const account = executionAccountParts(order.accountName, order.accountId);
  const details = [
    account.size ? `${account.size} account` : `Account ${order.accountId}`,
    formattedSize ? `Units ${formattedSize}` : undefined,
    order.status === "placed" ? undefined : orderStatusLabel(order.status),
    order.error ? `Note: ${truncate(order.error, 90)}` : undefined
  ].filter((part): part is string => Boolean(part));

  return {
    name: account.name,
    line: `- ${details.join(" | ")}`
  };
}

function executionLines(trade: TradeAlert): string[] {
  if (trade.autoTradeOrders?.length) {
    const groups = new Map<string, string[]>();
    for (const order of trade.autoTradeOrders.filter((item) => item.status !== "skipped" || item.error)) {
      const row = accountExecutionRow(order);
      const lines = groups.get(row.name) ?? [];
      lines.push(row.line);
      groups.set(row.name, lines);
    }
    return [...groups.entries()].flatMap(([name, lines]) => [`${name}:`, ...lines]);
  }

  if (!trade.autoTradeStatus && !trade.autoTradeError) return [];

  return [
    `- ${autoTradeStatusLabel(trade.autoTradeStatus)}${
      trade.autoTradeError ? ` | Note: ${truncate(trade.autoTradeError, 90)}` : ""
    }`
  ];
}

function autoTradeContractLabel(trade: TradeAlert): string | undefined {
  const orderContract =
    trade.autoTradeOrders?.find((order) => order.status === "placed" || order.status === "dry_run")?.contractName ??
    trade.autoTradeOrders?.find((order) => order.status === "placed" || order.status === "dry_run")?.contractId ??
    trade.autoTradeOrders?.find((order) => order.contractName || order.contractId)?.contractName ??
    trade.autoTradeOrders?.find((order) => order.contractName || order.contractId)?.contractId;
  return trade.autoTradeContractName?.trim() || trade.autoTradeContractId?.trim() || orderContract?.trim();
}

function telegramInstrumentLabel(trade: TradeAlert): string {
  return autoTradeContractLabel(trade) ?? trade.symbol;
}

function fitTelegramMessage(text: string): string {
  if (text.length <= TELEGRAM_MAX_TEXT_LENGTH) return text;
  return `${text.slice(0, TELEGRAM_MAX_TEXT_LENGTH - 24)}\n\n[message truncated]`;
}

function joinTelegramLines(lines: Array<string | undefined>): string {
  return lines.filter((line): line is string => line !== undefined).join("\n");
}

function telegramTitle(title: string): string {
  return `${TELEGRAM_SEPARATOR}\n<b>${escapeHtml(title)}</b>\n${TELEGRAM_SEPARATOR}`;
}

export function formatTelegramMessage(trade: TradeAlert): string {
  const dollarUnit = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = autoTradeOrderSize(trade.autoTradeOrders) ?? trade.sizeMultiplier ?? 1;
  const rawSizeScale = trade.sizeScale;
  const sizeScale = typeof rawSizeScale === "number" && Number.isFinite(rawSizeScale) && rawSizeScale > 0 ? rawSizeScale : undefined;
  const targetDollars = Math.abs(trade.tpUnits * dollarUnit * sizeMultiplier);
  const riskDollars = Math.abs(trade.slUnits * dollarUnit * sizeMultiplier);
  const rewardRisk = riskDollars > 0 ? targetDollars / riskDollars : 0;
  const side = trade.side === "long" ? "BUY" : "SELL";
  const execution = executionLines(trade);
  const instrumentLabel = telegramInstrumentLabel(trade);
  const sourceSignal = instrumentLabel !== trade.symbol ? `Signal ${escapeHtml(trade.symbol)}` : undefined;
  const lines = [
    telegramTitle(`${instrumentLabel} Trade`),
    sourceSignal,
    `Direction: <b>${side}</b>`,
    `Units: <b>${escapeHtml(telegramSizeLabel(trade, instrumentLabel, sizeMultiplier))}</b>`,
    "",
    `Entry: <code>${formatTradePrice(trade.entryPrice)}</code>`,
    `Take Profit: <code>${formatTradePrice(trade.takeProfitPrice)}</code>`,
    `Stop Loss: <code>${formatTradePrice(trade.stopLossPrice)}</code>`,
    sizeScale && Math.abs(sizeScale - 1) > 0.005 ? `Scale: ${escapeHtml(formatScale(sizeScale))}x` : undefined,
    "",
    `Edge: Win Rate <b>${formatNumber(trade.estimatedWinRatePct, 1)}%</b> | PF <b>${formatNumber(trade.liveProfitFactor)}</b> | RR <b>${formatNumber(rewardRisk)}R</b>`,
    execution.length ? "" : undefined,
    execution.length ? `<b>Execution:</b>` : undefined,
    execution.length ? execution.map(escapeHtml).join("\n") : undefined,
    `Signal: ${escapeHtml(formatSignalTime(trade.signalTime))}`
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
  const instrumentLabel = telegramInstrumentLabel(trade);
  const sourceSignal = instrumentLabel !== trade.symbol ? `Signal ${escapeHtml(trade.symbol)}` : undefined;
  const execution = executionLines(trade);
  const lines = [
    telegramTitle(`${instrumentLabel} ${title}`),
    sourceSignal,
    `Direction: <b>${side}</b>`,
    "",
    `<b>Result:</b>`,
    price !== undefined ? `Exit: <code>${formatTradePrice(price)}</code>` : undefined,
    pnl !== undefined ? `P/L: <b>${formatMoney(pnl, true)}</b>` : undefined,
    rMultiple !== undefined ? `R: <b>${formatNumber(rMultiple)}R</b>` : undefined,
    time ? `Time: ${escapeHtml(formatSignalTime(time))}` : undefined,
    "",
    `<b>Plan:</b>`,
    `Entry: <code>${formatTradePrice(trade.entryPrice)}</code>`,
    `Take Profit: <code>${formatTradePrice(trade.takeProfitPrice)}</code>`,
    `Stop Loss: <code>${formatTradePrice(trade.stopLossPrice)}</code>`,
    execution.length ? "" : undefined,
    execution.length ? `<b>Execution:</b>` : undefined,
    execution.length ? execution.map(escapeHtml).join("\n") : undefined
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
  const previous = event.previousPrice !== undefined ? `Previous: <code>${formatTradePrice(event.previousPrice)}</code>` : undefined;
  const reason = event.reason ? `Reason: ${escapeHtml(truncate(event.reason, 120))}` : undefined;
  const instrumentLabel = telegramInstrumentLabel(trade);
  const sourceSignal = instrumentLabel !== trade.symbol ? `Signal ${escapeHtml(trade.symbol)}` : undefined;
  const execution =
    event.autoTradeStatus || event.autoTradeError
      ? `${event.autoTradeStatus ? autoTradeStatusLabel(event.autoTradeStatus) : "Auto trade"}${
          event.autoTradeError ? ` - ${escapeHtml(truncate(event.autoTradeError, 160))}` : ""
        }`
      : undefined;
  const lines = [
    telegramTitle(`${instrumentLabel} ${managementEventTitle(event)}`),
    sourceSignal,
    `Direction: <b>${side}</b>`,
    "",
    `<b>Update:</b>`,
    `New: <code>${formatTradePrice(event.price)}</code>`,
    previous,
    reason,
    "",
    `<b>Plan:</b>`,
    `Entry: <code>${formatTradePrice(event.entryPrice ?? trade.entryPrice)}</code>`,
    `Take Profit: <code>${formatTradePrice(event.takeProfitPrice ?? (event.type === "edit_tp" ? event.price : trade.takeProfitPrice))}</code>`,
    `Stop Loss: <code>${formatTradePrice(event.stopLossPrice ?? (event.type === "edit_sl" ? event.price : trade.stopLossPrice))}</code>`,
    `Time: ${escapeHtml(formatSignalTime(event.time))}`,
    execution ? "" : undefined,
    execution ? `<b>Execution:</b>` : undefined,
    execution
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
