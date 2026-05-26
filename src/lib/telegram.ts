import type { TradeAlert, TradeManagementEvent } from "./types";
import { assetLookupSymbolForSymbol } from "./assets";
import { dollarPerUnit, instrumentSizeLabel } from "./instruments";

const TELEGRAM_MAX_TEXT_LENGTH = 3900;
const TELEGRAM_SEND_TIMEOUT_MS = 10_000;
const TELEGRAM_FALLBACK_TIME_ZONE = "America/Los_Angeles";
const NO_ACTIVE_AUTO_TRADE_ACCOUNTS = "No accounts were enabled for auto-trade on this signal.";
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
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatTradePrice(value: number): string {
  return `${formatPrice(value)}$`;
}

function shortTradePrice(value: number): string {
  return formatPrice(value);
}

function shortTradeLevel(price: number, dollars: number): string {
  return `${shortTradePrice(price)} ${formatMoney(dollars)}`;
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
  const formattedSize = formatOrderSize(order.size);
  const account = executionAccountParts(order.accountName, order.accountId);
  const accountLabel = account.size ? `${account.size} account` : `Account ${order.accountId}`;
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
    account.size ?? `Account ${order.accountId}`,
    formattedSize ? `x${formattedSize}` : undefined,
    order.status === "placed" ? undefined : orderStatusLabel(order.status),
    order.error ? truncate(order.error, 80) : undefined
  ].filter((part): part is string => Boolean(part));

  return {
    name: possessiveAccountsLabel(order.accountGroupName) ?? `${account.name}:`,
    line: `- ${details.join(" | ")}`
  };
}

function isNoActiveAutoTradeAccounts(value: string | undefined): boolean {
  return Boolean(value && /no (active auto-trade|connected unpaused projectx|topstepx projectx connection)/i.test(value));
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
    return [...groups.entries()].flatMap(([name, lines]) => [name, ...lines]);
  }

  if (!trade.autoTradeStatus && !trade.autoTradeError) return [];

  if (isNoActiveAutoTradeAccounts(trade.autoTradeError)) {
    return [NO_ACTIVE_AUTO_TRADE_ACCOUNTS];
  }

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
  const sourceSignal = instrumentLabel !== trade.symbol ? `Src ${escapeHtml(trade.symbol)}` : undefined;
  const lines = [
    `<b>${escapeHtml(instrumentLabel)} ${side}</b> | ${escapeHtml(telegramSizeLabel(trade, instrumentLabel, sizeMultiplier))}`,
    sourceSignal,
    `E <code>${shortTradePrice(trade.entryPrice)}</code> | TP <code>${shortTradeLevel(trade.takeProfitPrice, targetDollars)}</code> | SL <code>${shortTradeLevel(trade.stopLossPrice, riskDollars)}</code>`,
    `Edge ${formatNumber(trade.estimatedWinRatePct, 1)}% | PF ${formatNumber(trade.liveProfitFactor)} | ${formatNumber(rewardRisk)}R`,
    sizeScale && Math.abs(sizeScale - 1) > 0.005 ? `Scale: ${escapeHtml(formatScale(sizeScale))}x` : undefined,
    execution.length ? `<b>Exec:</b>` : undefined,
    execution.length ? execution.map(escapeHtml).join("\n") : undefined,
    `At ${escapeHtml(formatSignalTime(trade.signalTime))}`
  ];
  return fitTelegramMessage(joinTelegramLines(lines));
}

export function formatTelegramOutcomeMessage(trade: TradeAlert): string {
  const outcome = trade.lifecycleStatus;
  const title = outcome === "take_profit" ? "TP" : outcome === "stop_loss" ? "SL" : outcome === "max_bars" ? "Max Bars" : "Update";
  const pnl = autoTradeNetPnl(trade.autoTradeOrders) ?? trade.lifecyclePnlDollars;
  const rMultiple = trade.lifecycleRMultiple;
  const price = trade.lifecyclePrice;
  const time = trade.lifecycleTime;
  const side = trade.side === "long" ? "BUY" : "SELL";
  const instrumentLabel = telegramInstrumentLabel(trade);
  const sourceSignal = instrumentLabel !== trade.symbol ? `Src ${escapeHtml(trade.symbol)}` : undefined;
  const execution = executionLines(trade);
  const lines = [
    `<b>${escapeHtml(instrumentLabel)} ${title}</b> | ${side}`,
    sourceSignal,
    [
      price !== undefined ? `Exit <code>${shortTradePrice(price)}</code>` : undefined,
      pnl !== undefined ? `P/L <b>${formatMoney(pnl, true)}</b>` : undefined,
      rMultiple !== undefined ? `${formatNumber(rMultiple)}R` : undefined
    ]
      .filter((part): part is string => Boolean(part))
      .join(" | "),
    `Plan E ${shortTradePrice(trade.entryPrice)} | TP ${shortTradePrice(trade.takeProfitPrice)} | SL ${shortTradePrice(trade.stopLossPrice)}`,
    time ? `Time ${escapeHtml(formatSignalTime(time))}` : undefined,
    execution.length ? `<b>Exec:</b>` : undefined,
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
  const sourceSignal = instrumentLabel !== trade.symbol ? `Src ${escapeHtml(trade.symbol)}` : undefined;
  const execution =
    event.autoTradeStatus || event.autoTradeError
      ? `${event.autoTradeStatus ? autoTradeStatusLabel(event.autoTradeStatus) : "Auto trade"}${
          event.autoTradeError ? ` - ${escapeHtml(truncate(event.autoTradeError, 160))}` : ""
        }`
      : undefined;
  const lines = [
    `<b>${escapeHtml(instrumentLabel)} ${managementEventTitle(event)}</b> | ${side}`,
    sourceSignal,
    [
      `New <code>${shortTradePrice(event.price)}</code>`,
      previous ? previous.replace("Previous:", "Prev").replace(formatTradePrice(event.previousPrice!), shortTradePrice(event.previousPrice!)) : undefined
    ]
      .filter((part): part is string => Boolean(part))
      .join(" | "),
    reason,
    `Plan E ${shortTradePrice(event.entryPrice ?? trade.entryPrice)} | TP ${shortTradePrice(event.takeProfitPrice ?? (event.type === "edit_tp" ? event.price : trade.takeProfitPrice))} | SL ${shortTradePrice(event.stopLossPrice ?? (event.type === "edit_sl" ? event.price : trade.stopLossPrice))}`,
    `Time ${escapeHtml(formatSignalTime(event.time))}`,
    execution ? `<b>Exec:</b>` : undefined,
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
