import type { TradeAlert, TradeManagementEvent } from "./types";
import { realAutoTradeSizeForTrade } from "./auto-trade-utils";
import { assetLookupSymbolForSymbol } from "./assets";
import { dollarPerUnit, instrumentSizeLabel } from "./instruments";
import { marketFeatureEnabled } from "./feature-availability";

const TELEGRAM_MAX_TEXT_LENGTH = 3900;
const TELEGRAM_SEND_TIMEOUT_MS = 10_000;
const TELEGRAM_SEPARATOR = "-------------------------------------------------------";
const TELEGRAM_FALLBACK_TIME_ZONE = "America/Los_Angeles";
const NO_ACCOUNTS_MESSAGE = "No Accounts";
const FUNDED_ACCOUNT_SIZE_PATTERN = /\b(50|100|150|200|250|300)\s*k(?:\s*tc)?\b/i;

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

function fundedAccountSize(value: string): string | undefined {
  const match = value.match(FUNDED_ACCOUNT_SIZE_PATTERN);
  return match ? `${match[1]}K` : undefined;
}

function compactAccountName(value: string | undefined, accountId: number): string {
  const label = value?.trim();
  if (!label) return `Account ${accountId}`;
  return fundedAccountSize(label) ?? label;
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
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);
}

function formatUnits(
  value: number | undefined,
  sizeUnit?: NonNullable<TradeAlert["autoTradeOrders"]>[number]["sizeUnit"]
): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const formatted = formatOrderSize(value);
  if (sizeUnit === "lots") return `${formatted} FX lot`;
  if (sizeUnit === "base_units") return `${formatted} unit${Math.abs(value - 1) < 1e-9 ? "" : "s"}`;
  return `${formatted} unit${Math.abs(value - 1) < 1e-9 ? "" : "s"}`;
}

function formatTradePrice(value: number): string {
  return `${formatPrice(value)}$`;
}

function formatTradePriceWithMoney(price: number, dollars: number): string {
  return `${formatTradePrice(price)} / ${formatMoney(dollars)}`;
}

function formatSuffixMoney(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  }).format(Math.abs(value));
  return `${sign}${formatted}$`;
}

function autoTradeNetPnl(orders: TradeAlert["autoTradeOrders"]): number | undefined {
  const placedOrders = (orders ?? []).filter((order) => order.status === "placed");
  const values = placedOrders
    .map((order) => order.netPnlDollars)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!placedOrders.length || values.length !== placedOrders.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0);
}

function telegramSizeLabel(trade: TradeAlert, instrumentLabel: string, fallbackSizeMultiplier: number): string {
  const executableOrders = (trade.autoTradeOrders ?? []).filter(
    (order) =>
      (order.status === "placed" || order.status === "dry_run") &&
      typeof order.size === "number" &&
      Number.isFinite(order.size) &&
      order.size > 0
  );
  if (executableOrders.length) {
    const sizeUnits = new Set(executableOrders.map((order) => order.sizeUnit ?? "strategy"));
    if (sizeUnits.size === 1 && sizeUnits.has("lots")) {
      const lots = executableOrders.reduce((sum, order) => sum + Math.abs(order.size!), 0);
      return `${formatOrderSize(lots) ?? formatNumber(lots)} FX lot`;
    }
    if (sizeUnits.size === 1 && sizeUnits.has("base_units")) {
      const units = executableOrders.reduce((sum, order) => sum + Math.abs(order.size!), 0);
      return `${formatOrderSize(units) ?? formatNumber(units)} unit${Math.abs(units - 1) < 1e-9 ? "" : "s"}`;
    }
  }
  const lookupSymbol = assetLookupSymbolForSymbol(trade.symbol);
  if (instrumentLabel !== trade.symbol && instrumentLabel !== lookupSymbol) {
    return `${formatOrderSize(fallbackSizeMultiplier) ?? formatNumber(fallbackSizeMultiplier)} ${instrumentLabel}`;
  }
  return instrumentSizeLabel(trade.symbol, fallbackSizeMultiplier);
}

function accountOrderLine(order: NonNullable<TradeAlert["autoTradeOrders"]>[number]): string {
  const formattedSize = formatUnits(order.size, order.sizeUnit);
  const parts = [
    orderStatusLabel(order.status),
    typeof order.accountBalance === "number" && Number.isFinite(order.accountBalance) ? `Balance ${formatMoney(order.accountBalance)}` : undefined,
    formattedSize ? `Size ${formattedSize}` : undefined,
    order.orderId ? `Order ${order.orderId}` : undefined
  ].filter((part): part is string => Boolean(part));

  return `- ${compactAccountName(order.accountName, order.accountId)}: ${parts.join(" | ")}${
    order.error && order.status !== "placed" && order.status !== "failed" && order.status !== "skipped"
      ? ` | ${truncate(order.error, 120)}`
      : ""
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
  const fundedSize = fundedAccountSize(label);
  const name = fundedSize
    ? label
        .replace(FUNDED_ACCOUNT_SIZE_PATTERN, "")
        .replace(/[-|()[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : label;
  return {
    name: name || label,
    size: fundedSize
  };
}

function possessiveAccountsLabel(value: string | undefined): string | undefined {
  const label = value?.trim();
  if (!label) return undefined;
  if (/\baccounts?\s*:?$/i.test(label)) return label.replace(/\s*:?\s*$/, ":");
  return `${label}${label.endsWith("'") || /s$/i.test(label) ? "'" : "'s"} Accounts:`;
}

function accountExecutionRow(order: NonNullable<TradeAlert["autoTradeOrders"]>[number]): { line: string; name: string } {
  const formattedSize = formatUnits(order.size, order.sizeUnit);
  const account = executionAccountParts(order.accountName, order.accountId);
  const accountLabel = [
    `Account ${order.accountId}`,
    typeof order.accountBalance === "number" && Number.isFinite(order.accountBalance) ? `Balance ${formatMoney(order.accountBalance)}` : undefined
  ].filter((part): part is string => Boolean(part)).join(" | ");
  if (typeof order.netPnlDollars === "number" && Number.isFinite(order.netPnlDollars)) {
    return {
      name: possessiveAccountsLabel(order.accountGroupName) ?? `${account.name}:`,
      line: `${accountLabel}: ${formatSuffixMoney(order.netPnlDollars)}`
    };
  }
  if (order.resultError) {
    return {
      name: possessiveAccountsLabel(order.accountGroupName) ?? `${account.name}:`,
      line: `${accountLabel}: pending`
    };
  }
  const details = [
    accountLabel,
    formattedSize,
    order.status === "placed" ? undefined : orderStatusLabel(order.status),
    order.status !== "placed" && order.error ? truncate(order.error, 80) : undefined
  ].filter((part): part is string => Boolean(part));

  return {
    name: possessiveAccountsLabel(order.accountGroupName) ?? `${account.name}:`,
    line: `- ${details.join(" | ")}`
  };
}

function isNoLoginMessage(value: string | undefined): boolean {
  if (!value) return false;
  return [
    /no\s+(?:active\s+auto-trade\s+)?accounts?/i,
    /no\s+live\s+(?:futures|forex)\s+connector\s+is\s+connected/i,
    /no\s+(?:topstepx\s+)?projectx\s+connection\s+is\s+available/i,
    /could\s+not\s+discover\s+an?\s+account/i,
    /connection\s+for\s+this\s+account\s+is\s+no\s+longer\s+active/i,
    /account\s+(?:folder\s+is\s+no\s+longer\s+connected|was\s+not\s+found)/i,
    /configured\s+projectx_auto_trade_account_id\s+was\s+not\s+found\s+or\s+is\s+paused/i,
    /missing\s+.+\s+(?:credentials|bridge\s+settings)/i
  ].some((pattern) => pattern.test(value));
}

function isNoLoginOrder(order: NonNullable<TradeAlert["autoTradeOrders"]>[number]): boolean {
  return order.status === "skipped" && isNoLoginMessage(order.error);
}

function executionLines(trade: TradeAlert): string[] {
  if (trade.autoTradeOrders?.length) {
    const actionableOrders = trade.autoTradeOrders.filter((order) => order.status !== "skipped" || !isNoLoginOrder(order));
    if (!actionableOrders.length) {
      return [NO_ACCOUNTS_MESSAGE];
    }

    const groups = new Map<string, string[]>();
    for (const order of actionableOrders.filter((item) => item.status !== "skipped" || item.error)) {
      const row = accountExecutionRow(order);
      const lines = groups.get(row.name) ?? [];
      lines.push(row.line);
      groups.set(row.name, lines);
    }
    return [
      ...[...groups.entries()].flatMap(([name, lines], index) => (index === 0 ? [name, ...lines] : ["", name, ...lines]))
    ].filter((line): line is string => Boolean(line));
  }

  if (!trade.autoTradeStatus && !trade.autoTradeError) return [];

  if (isNoLoginMessage(trade.autoTradeError)) {
    return [NO_ACCOUNTS_MESSAGE];
  }

  return [
    `- ${autoTradeStatusLabel(trade.autoTradeStatus)}${
      trade.autoTradeError ? ` | Note: ${truncate(trade.autoTradeError, 90)}` : ""
    }`
  ].filter((line): line is string => Boolean(line));
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
  const sizeMultiplier = realAutoTradeSizeForTrade(trade);
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
    "",
    sourceSignal,
    `Direction: <b>${side}</b>`,
    `Units: <b>${escapeHtml(telegramSizeLabel(trade, instrumentLabel, sizeMultiplier))}</b>`,
    "",
    `Entry: <code>${formatTradePrice(trade.entryPrice)}</code>`,
    `Take Profit: <code>${formatTradePriceWithMoney(trade.takeProfitPrice, targetDollars)}</code>`,
    `Stop Loss: <code>${formatTradePriceWithMoney(trade.stopLossPrice, -riskDollars)}</code>`,
    sizeScale && Math.abs(sizeScale - 1) > 0.005 ? `Scale: ${escapeHtml(formatScale(sizeScale))}x` : undefined,
    "",
    `Edge: Win Rate <b>${formatNumber(trade.estimatedWinRatePct, 1)}%</b> | PF <b>${formatNumber(trade.liveProfitFactor)}</b> | RR <b>${formatNumber(rewardRisk)}R</b>`,
    execution.length ? "" : undefined,
    execution.length ? `<b>Execution:</b>` : undefined,
    execution.length ? execution.map(escapeHtml).join("\n") : undefined,
    execution.length ? "" : undefined,
    `Signal: ${escapeHtml(formatSignalTime(trade.signalTime))}`
  ];
  return fitTelegramMessage(joinTelegramLines(lines));
}

export function formatTelegramOutcomeMessage(trade: TradeAlert): string {
  const outcome = trade.lifecycleStatus;
  const isTarget = outcome === "take_profit";
  const title = isTarget
    ? "Take Profit Hit"
    : outcome === "stop_loss"
      ? "Stop Loss Hit"
      : outcome === "max_bars"
        ? "Max Bars Exit"
        : outcome === "broker_close"
          ? "Broker Close"
          : "Trade Update";
  const pnl = autoTradeNetPnl(trade.autoTradeOrders) ?? trade.lifecyclePnlDollars;
  const rMultiple = trade.lifecycleRMultiple;
  const price = trade.lifecyclePrice;
  const time = trade.lifecycleTime;
  const side = trade.side === "long" ? "BUY" : "SELL";
  const instrumentLabel = telegramInstrumentLabel(trade);
  const sourceSignal = instrumentLabel !== trade.symbol ? `Signal ${escapeHtml(trade.symbol)}` : undefined;
  const execution = executionLines(trade);
  const dollarUnit = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = realAutoTradeSizeForTrade(trade);
  const targetDollars = Math.abs(trade.tpUnits * dollarUnit * sizeMultiplier);
  const riskDollars = Math.abs(trade.slUnits * dollarUnit * sizeMultiplier);
  const lines = [
    telegramTitle(`${instrumentLabel} ${title}`),
    "",
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
    `Take Profit: <code>${formatTradePriceWithMoney(trade.takeProfitPrice, targetDollars)}</code>`,
    `Stop Loss: <code>${formatTradePriceWithMoney(trade.stopLossPrice, -riskDollars)}</code>`,
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
  const dollarUnit = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = realAutoTradeSizeForTrade(trade, trade.sizeMultiplier ?? 1, event.autoTradeOrders);
  const targetDollars = Math.abs(trade.tpUnits * dollarUnit * sizeMultiplier);
  const riskDollars = Math.abs(trade.slUnits * dollarUnit * sizeMultiplier);
  const execution =
    isNoLoginMessage(event.autoTradeError)
      ? NO_ACCOUNTS_MESSAGE
      : event.autoTradeStatus || event.autoTradeError
      ? `${event.autoTradeStatus ? autoTradeStatusLabel(event.autoTradeStatus) : "Auto trade"}${
          event.autoTradeError ? ` - ${escapeHtml(truncate(event.autoTradeError, 160))}` : ""
        }`
      : undefined;
  const lines = [
    telegramTitle(`${instrumentLabel} ${managementEventTitle(event)}`),
    "",
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
    `Take Profit: <code>${formatTradePriceWithMoney(event.takeProfitPrice ?? (event.type === "edit_tp" ? event.price : trade.takeProfitPrice), targetDollars)}</code>`,
    `Stop Loss: <code>${formatTradePriceWithMoney(event.stopLossPrice ?? (event.type === "edit_sl" ? event.price : trade.stopLossPrice), -riskDollars)}</code>`,
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
  if (!marketFeatureEnabled(trade.market)) return { status: "skipped" };
  return sendTelegramText(formatTelegramMessage(trade));
}

export async function sendTelegramOutcome(trade: TradeAlert): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  if (!marketFeatureEnabled(trade.market)) return { status: "skipped" };
  return sendTelegramText(formatTelegramOutcomeMessage(trade));
}

export async function sendTelegramManagement(
  trade: TradeAlert,
  event: TradeManagementEvent
): Promise<{ status: "sent" | "skipped" | "failed"; error?: string }> {
  if (!marketFeatureEnabled(trade.market)) return { status: "skipped" };
  return sendTelegramText(formatTelegramManagementMessage(trade, event));
}
