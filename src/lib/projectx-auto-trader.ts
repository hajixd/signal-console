import { createHash } from "node:crypto";
import { assetForKey, assetForSymbol, assetLookupSymbolForSymbol } from "@/lib/assets";
import { buildAutoTradeTestTrade } from "@/lib/auto-trade-test";
import { scaledAutoTradeSize } from "@/lib/auto-trade-utils";
import { dollarPerUnit } from "@/lib/instruments";
import {
  getStoredProjectXConnections,
  markStoredProjectXConnectionExpired,
  saveStoredProjectXConnection,
  type StoredProjectXConnection
} from "@/lib/projectx-connections";
import { getTrades } from "@/lib/storage";
import {
  closeProjectXPosition,
  listProjectXAvailableContracts,
  modifyProjectXOrder,
  placeProjectXOrder,
  readableProjectXError,
  searchProjectXOpenOrders,
  searchProjectXOpenPositions,
  searchProjectXAccounts,
  searchProjectXContracts,
  searchProjectXOrders,
  searchProjectXTrades,
  validateProjectXSession,
  type ProjectXAccount,
  type ProjectXContract,
  type ProjectXOpenPosition,
  type ProjectXOrder,
  type ProjectXOpenOrder,
  type ProjectXOrderSide,
  type ProjectXOrderType,
  type ProjectXPlaceOrderRequest,
  type ProjectXTrade
} from "@/lib/projectx";
import type { AutoTradeOrderSummary, TradeAlert, TradeManagementEvent } from "@/lib/types";

export type ProjectXAutoTradeStatus = "disabled" | "dry_run" | "failed" | "placed" | "skipped";

export type ProjectXAutoTradeResult = {
  accountId?: number;
  accountName?: string;
  checkedAt: string;
  contractId?: string;
  contractName?: string;
  customTag?: string;
  error?: string;
  orderId?: number;
  orders?: AutoTradeOrderSummary[];
  status: ProjectXAutoTradeStatus;
  testMessage?: string;
  testStatus?: "success";
};

const CONTRACT_SEARCH_OVERRIDES: Record<string, string> = {
  "6A": "M6A",
  "6B": "M6B",
  "6C": "6C",
  "6E": "M6E",
  "6J": "6J",
  "6M": "6M",
  "6N": "6N",
  "6S": "6S",
  CL: "MCL",
  E7: "E7",
  ES: "MES",
  GC: "MGC",
  HG: "MHG",
  HE: "HE",
  HO: "HO",
  LE: "LE",
  M2K: "M2K",
  M6A: "M6A",
  M6B: "M6B",
  M6E: "M6E",
  MBT: "MBT",
  MCL: "MCL",
  MES: "MES",
  MET: "MET",
  MGC: "MGC",
  MHG: "MHG",
  MNQ: "MNQ",
  MNG: "MNG",
  MYM: "MYM",
  NG: "MNG",
  NKD: "NKD",
  NQ: "MNQ",
  PL: "PL",
  QG: "QG",
  QM: "QM",
  RB: "RB",
  RTY: "M2K",
  SI: "SIL",
  SIL: "SIL",
  TN: "TN",
  UB: "UB",
  YM: "MYM",
  ZB: "ZB",
  ZC: "ZC",
  ZF: "ZF",
  ZL: "ZL",
  ZM: "ZM",
  ZN: "ZN",
  ZS: "ZS",
  ZT: "ZT",
  ZW: "ZW"
};
const FUTURES_MONTH_CODES = "FGHJKMNQUVXZ";
const NO_ACTIVE_AUTO_TRADE_ACCOUNTS = "no active auto-trade accounts";
const PROJECTX_TRADE_RESULT_LOOKBACK_MS = 5 * 60_000;
const PROJECTX_TRADE_RESULT_LOOKAHEAD_MS = 15 * 60_000;
const PROJECTX_TRADE_RESULT_MAX_LOOKAHEAD_HOURS = 24;
const PROJECTX_TEST_CLOSE_ATTEMPTS = 10;
const PROJECTX_TEST_CLOSE_WAIT_MS = 650;
const PROJECTX_PAST_FAILURE_SIZE_LOOKBACK_HOURS = 24;
const PROJECTX_DUPLICATE_ORDER_LOOKBACK_HOURS = 48;
const PROJECTX_CHICAGO_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
const STANDARD_TOPSTEP_MAX_MINIS_BY_ACCOUNT_SIZE: Record<50 | 100 | 150, number> = {
  50: 5,
  100: 10,
  150: 15
};
const STANDARD_MICRO_ROOTS = new Set(["M2K", "M6A", "M6B", "M6E", "MCL", "MES", "MGC", "MHG", "MNG", "MNQ", "MYM"]);
const SPECIAL_MICRO_ROOTS = new Set(["SIL", "MBT", "MET"]);

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function positiveIntegerEnv(name: string): number | undefined {
  const numeric = Number(process.env[name]);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function parseContractOverrides(): Record<string, string> {
  const raw = process.env.PROJECTX_CONTRACT_SEARCH_OVERRIDES?.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([symbol, searchText]) => [symbol.trim().toUpperCase(), typeof searchText === "string" ? searchText.trim().toUpperCase() : ""])
        .filter(([, searchText]) => Boolean(searchText))
    );
  } catch {
    return Object.fromEntries(
      raw
        .split(",")
        .map((entry) => entry.split(":"))
        .map(([symbol, searchText]) => [symbol?.trim().toUpperCase() ?? "", searchText?.trim().toUpperCase() ?? ""])
        .filter(([symbol, searchText]) => Boolean(symbol && searchText))
    );
  }
}

function projectXContractLiveFlag(): boolean {
  return envFlag("PROJECTX_CONTRACT_LIVE", false);
}

export function projectXAutoTradingEnabled(): boolean {
  return envFlag("PROJECTX_AUTO_TRADE_ENABLED", true);
}

function dryRunEnabled(): boolean {
  return envFlag("PROJECTX_AUTO_TRADE_DRY_RUN", false);
}

function positionBracketFallbackEnabled(): boolean {
  return envFlag("PROJECTX_POSITION_BRACKET_FALLBACK_ENABLED", true);
}

function adaptiveSizeFallbackEnabled(): boolean {
  return envFlag("PROJECTX_ADAPTIVE_SIZE_FALLBACK_ENABLED", true);
}

function pretradeRiskLookupEnabled(): boolean {
  return envFlag("PROJECTX_PRETRADE_RISK_LOOKUP_ENABLED", true);
}

function topstepSessionGuardEnabled(): boolean {
  return envFlag("PROJECTX_TOPSTEP_SESSION_GUARD_ENABLED", true);
}

function result(status: ProjectXAutoTradeStatus, fields: Omit<ProjectXAutoTradeResult, "checkedAt" | "status"> = {}): ProjectXAutoTradeResult {
  return {
    checkedAt: new Date().toISOString(),
    status,
    ...fields
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function topstepExecutionSessionBlockReason(now = new Date()): string | undefined {
  if (!topstepSessionGuardEnabled()) return undefined;
  const parts = Object.fromEntries(PROJECTX_CHICAGO_FORMATTER.formatToParts(now).map((part) => [part.type, part.value]));
  const weekday = parts.weekday;
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const minute = Number(parts.minute);
  const minutes = hour * 60 + minute;
  const timeLabel = `${weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} CT`;

  if (weekday === "Sat") return `Skipped before ProjectX order placement because Topstep is closed on Saturday (${timeLabel}).`;
  if (weekday === "Sun" && minutes < 17 * 60) {
    return `Skipped before ProjectX order placement because Topstep reopens Sunday at 5:00 PM CT (${timeLabel}).`;
  }
  if (weekday === "Fri" && minutes >= 15 * 60) {
    return `Skipped before ProjectX order placement because Topstep weekend cutoff has started (${timeLabel}).`;
  }
  if (minutes >= 15 * 60 && minutes < 17 * 60) {
    return `Skipped before ProjectX order placement because Topstep does not allow new trades between 3:00 PM and 5:00 PM CT (${timeLabel}).`;
  }
  return undefined;
}

function wholeNumber(value: number | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }

  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > 1e-6 || rounded <= 0) {
    throw new Error(`${label} must be a whole number for ProjectX orders.`);
  }
  return rounded;
}

function positiveNumber(value: number | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return value;
}

function customTagForTrade(trade: TradeAlert, accountId: number): string {
  const hash = createHash("sha256").update(`${trade.id}:${accountId}`).digest("hex").slice(0, 24);
  return `tb_${hash}`;
}

function customTagForAttempt(baseTag: string, size: number, originalSize: number): string {
  if (size === originalSize) return baseTag;
  return `${baseTag}_u${size}`;
}

function projectXOrderSizeForAccount(trade: TradeAlert, account: ProjectXAccount, fallbackBaseSize: number): number {
  if ((trade.orderLeg === "entry" || trade.orderLeg === "limit") && typeof trade.splitOrderTotalSizeMultiplier === "number") {
    const totalSize = scaledAutoTradeSize(trade.splitOrderTotalSizeMultiplier, account, { minSize: 0, wholeNumber: true });
    if (totalSize <= 0) return 0;
    const entrySize = Math.ceil(totalSize * 0.5);
    return trade.orderLeg === "entry" ? entrySize : Math.max(0, totalSize - entrySize);
  }

  return scaledAutoTradeSize(fallbackBaseSize, account, { minSize: 0, wholeNumber: true });
}

function projectXPastFailureLookbackMs(): number {
  const configured = Number(process.env.PROJECTX_PAST_FAILURE_SIZE_LOOKBACK_HOURS);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : PROJECTX_PAST_FAILURE_SIZE_LOOKBACK_HOURS;
  return hours * 60 * 60_000;
}

function projectXDuplicateOrderLookbackMs(): number {
  const configured = Number(process.env.PROJECTX_DUPLICATE_ORDER_LOOKBACK_HOURS);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : PROJECTX_DUPLICATE_ORDER_LOOKBACK_HOURS;
  return hours * 60 * 60_000;
}

function projectXTradeResultMaxLookaheadMs(): number {
  const configured = Number(process.env.PROJECTX_TRADE_RESULT_MAX_LOOKAHEAD_HOURS);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : PROJECTX_TRADE_RESULT_MAX_LOOKAHEAD_HOURS;
  return hours * 60 * 60_000;
}

function isSizeReducibleProjectXError(message: string): boolean {
  return [
    /\bcode\s*3\b/i,
    /insufficient\s+(?:funds?|margin|buying\s+power|purchasing\s+power)/i,
    /not\s+enough\s+(?:funds?|margin|buying\s+power|purchasing\s+power)/i,
    /(?:exceeds?|exceeded|over)\s+(?:the\s+)?(?:maximum\s+)?(?:margin|contract|position|size|risk)/i,
    /(?:max|maximum)\s+(?:margin|contracts?|position|position\s+size|order\s+size)/i,
    /(?:contract|position|order\s+size|quantity)\s+limit/i,
    /too\s+many\s+contracts?/i
  ].some((pattern) => pattern.test(message));
}

function isProjectXTradingLockoutError(message: string): boolean {
  return [
    /daily\s+loss\s+limit/i,
    /maximum\s+loss\s+limit/i,
    /\bmax\s+loss\s+limit\b/i,
    /auto-?liquidat/i,
    /liquidate\s+and\s+block/i,
    /blocked?\s+(?:for|from)\s+(?:trading|placing)/i,
    /account\s+(?:is\s+)?(?:locked|blocked|disabled|deactivated|not\s+tradeable|cannot\s+trade)/i,
    /prevented\s+from\s+placing\s+(?:any\s+)?new\s+trades/i,
    /no\s+new\s+trades\s+until/i
  ].some((pattern) => pattern.test(message));
}

function isProjectXMarketUnavailableError(message: string): boolean {
  return [
    /market\s+(?:is\s+)?(?:closed|halted|unavailable)/i,
    /outside\s+(?:regular\s+)?trading\s+hours/i,
    /trading\s+(?:session\s+)?(?:is\s+)?closed/i,
    /instrument\s+(?:is\s+)?(?:not\s+)?trad(?:eable|able)/i,
    /contract\s+(?:is\s+)?(?:not\s+)?(?:active|trad(?:eable|able)|available)/i,
    /not\s+accepting\s+orders/i,
    /order\s+entry\s+(?:is\s+)?disabled/i
  ].some((pattern) => pattern.test(message));
}

function isProjectXDuplicateCustomTagError(message: string): boolean {
  return /custom\s*tag|customtag|duplicate|unique|already\s+(?:exists|used)/i.test(message);
}

function isMissingProjectXOrderIdError(message: string): boolean {
  return /did\s+not\s+return\s+an\s+order\s+id/i.test(message);
}

function projectXSkippableOrderError(message: string): boolean {
  return isProjectXTradingLockoutError(message) || isProjectXMarketUnavailableError(message);
}

function orderMatchesProjectXTrade(order: AutoTradeOrderSummary, trade: TradeAlert, contract?: ProjectXContract): boolean {
  const contractLabels = [contract?.id, contract?.name, trade.symbol].filter((value): value is string => Boolean(value));
  return contractLabels.some((label) => {
    const normalized = label.trim().toUpperCase();
    return (
      order.contractId?.trim().toUpperCase() === normalized ||
      order.contractName?.trim().toUpperCase() === normalized ||
      trade.symbol.trim().toUpperCase() === normalized
    );
  });
}

function adaptiveSizeMaxAttempts(): number {
  const configured = Number(process.env.PROJECTX_ADAPTIVE_SIZE_MAX_ATTEMPTS);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, 20) : 8;
}

function sizeAttemptSequence(size: number): number[] {
  const start = Math.max(1, Math.floor(size));
  const maxAttempts = adaptiveSizeMaxAttempts();
  if (start <= maxAttempts) {
    return Array.from({ length: start }, (_, index) => start - index);
  }

  const attempts = new Set<number>([start, start - 1]);
  let current = start - 1;
  while (attempts.size < maxAttempts - 1 && current > 1) {
    current = Math.max(1, Math.floor(current * 0.5));
    attempts.add(current);
  }
  attempts.add(1);
  return [...attempts].sort((left, right) => right - left);
}

function unitsLabel(size: number): string {
  return `${size} unit${size === 1 ? "" : "s"}`;
}

async function recentProjectXSizeFailureCap(
  accountId: number,
  trade: TradeAlert,
  contract?: ProjectXContract,
  trades?: TradeAlert[]
): Promise<{ reason: string; size: number } | null> {
  if (!adaptiveSizeFallbackEnabled()) return null;

  try {
    const oldest = Date.now() - projectXPastFailureLookbackMs();
    const history = trades ?? await getTrades();
    for (const pastTrade of history) {
      const timestamp = Date.parse(pastTrade.autoTradeCheckedAt ?? pastTrade.signalTime);
      if (Number.isFinite(timestamp) && timestamp < oldest) continue;
      if (pastTrade.market !== trade.market || pastTrade.symbol !== trade.symbol) continue;

      const orders = [...(pastTrade.autoTradeOrders ?? []), ...(pastTrade.limitOrderAutoTradeOrders ?? [])];
      const failedOrder = orders.find(
        (order) =>
          order.accountId === accountId &&
          order.status === "failed" &&
          typeof order.size === "number" &&
          Number.isFinite(order.size) &&
          order.size > 0 &&
          Boolean(order.error) &&
          isSizeReducibleProjectXError(order.error!) &&
          orderMatchesProjectXTrade(order, trade, contract)
      );
      if (!failedOrder?.error || typeof failedOrder.size !== "number") continue;
      return {
        reason: failedOrder.error,
        size: Math.max(1, Math.floor(failedOrder.size))
      };
    }
  } catch {
    return null;
  }

  return null;
}

function uniqueSearchTexts(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value?.trim().toUpperCase() ?? "")
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function futuresRootFromContractSymbol(symbol: string): string | undefined {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const roots = Object.keys(CONTRACT_SEARCH_OVERRIDES).sort((left, right) => right.length - left.length);
  return roots.find((root) => {
    const suffix = normalizedSymbol.slice(root.length);
    return (
      normalizedSymbol.startsWith(root) &&
      suffix.length >= 2 &&
      suffix.length <= 3 &&
      FUTURES_MONTH_CODES.includes(suffix[0] ?? "") &&
      /^\d{1,2}$/.test(suffix.slice(1))
    );
  });
}

export function contractSearchTextsForTrade(trade: Pick<TradeAlert, "assetKey" | "symbol">): string[] {
  const symbol = trade.symbol.trim().toUpperCase();
  const overrides = parseContractOverrides();

  const asset = trade.assetKey ? assetForKey(trade.assetKey) : assetForSymbol(symbol);
  const assetSymbol = asset?.symbol.trim().toUpperCase();
  const contractRoot = futuresRootFromContractSymbol(symbol);
  const sizeRoot = asset?.sizeLabel.match(/^\s*\d+(?:\.\d+)?\s+([A-Z][A-Z0-9]{1,4})\b/)?.[1];
  const usableSizeRoot = sizeRoot && !["CONTRACT", "FUTURE", "FX", "MICRO", "MINI"].includes(sizeRoot) ? sizeRoot : undefined;

  return uniqueSearchTexts([
    overrides[symbol],
    assetSymbol ? overrides[assetSymbol] : undefined,
    contractRoot,
    contractRoot ? CONTRACT_SEARCH_OVERRIDES[contractRoot] : undefined,
    usableSizeRoot,
    CONTRACT_SEARCH_OVERRIDES[symbol],
    assetSymbol ? CONTRACT_SEARCH_OVERRIDES[assetSymbol] : undefined,
    assetSymbol ? assetLookupSymbolForSymbol(assetSymbol) : undefined,
    symbol.length > 2 ? symbol : undefined,
    assetSymbol,
    assetLookupSymbolForSymbol(symbol),
    symbol
  ]);
}

export function projectXBracketTicksForTrade(
  trade: Pick<TradeAlert, "entryPrice" | "side" | "slUnits" | "stopLossPrice" | "takeProfitPrice" | "tpUnits">
): { stopLossTicks: number; takeProfitTicks: number } {
  const direction = trade.side === "long" ? 1 : -1;
  const takeProfitDistance = direction * (trade.takeProfitPrice - trade.entryPrice);
  const stopLossDistance = direction * (trade.entryPrice - trade.stopLossPrice);
  if (!(takeProfitDistance > 0 && stopLossDistance > 0)) {
    throw new Error(`Invalid ${trade.side} ProjectX bracket geometry: TP/SL must be on the correct side of entry.`);
  }

  const stopLossTicks = wholeNumber(Math.abs(trade.slUnits), "Stop-loss ticks") * -direction;
  const takeProfitTicks = wholeNumber(Math.abs(trade.tpUnits), "Take-profit ticks") * direction;
  return {
    stopLossTicks,
    takeProfitTicks
  };
}

function contractScore(contract: ProjectXContract, searchText: string): number {
  const normalizedSearch = searchText.trim().toUpperCase();
  const id = contract.id.toUpperCase();
  const name = contract.name.toUpperCase();
  const symbolId = contract.symbolId?.toUpperCase() ?? "";
  let score = contract.activeContract ? 100 : 0;

  if (name.startsWith(normalizedSearch)) score += 40;
  if (symbolId.endsWith(`.${normalizedSearch}`) || symbolId === normalizedSearch) score += 35;
  if (id.includes(`.${normalizedSearch}.`)) score += 30;
  if (name.includes(normalizedSearch)) score += 10;
  return score;
}

function bestContract(contracts: ProjectXContract[], searchText: string): ProjectXContract | null {
  return [...contracts].sort((left, right) => contractScore(right, searchText) - contractScore(left, searchText))[0] ?? null;
}

type ProjectXContractLookup = {
  contract: ProjectXContract | null;
  error?: string;
  searchTexts: string[];
  selectedSearchText?: string;
};

async function projectXContractForTrade(token: string, trade: TradeAlert): Promise<ProjectXContractLookup> {
  const searchTexts = contractSearchTextsForTrade(trade);
  const errors: string[] = [];
  for (const searchText of searchTexts) {
    try {
      const contract = bestContract(await searchProjectXContracts(token, searchText, projectXContractLiveFlag()), searchText);
      if (contract) return { contract, searchTexts, selectedSearchText: searchText };
    } catch (error) {
      errors.push(`${searchText}: ${readableProjectXError(error)}`);
    }
  }

  try {
    const availableContracts = await listProjectXAvailableContracts(token, projectXContractLiveFlag());
    const fallback = searchTexts
      .map((searchText) => ({ contract: bestContract(availableContracts, searchText), searchText }))
      .filter((entry): entry is { contract: ProjectXContract; searchText: string } => Boolean(entry.contract))
      .sort((left, right) => contractScore(right.contract, right.searchText) - contractScore(left.contract, left.searchText))[0];
    if (fallback) {
      return {
        contract: fallback.contract,
        error: errors.length ? `Contract search had errors before available-contract fallback: ${errors.join("; ")}` : undefined,
        searchTexts,
        selectedSearchText: fallback.searchText
      };
    }
  } catch (error) {
    errors.push(`available-contract fallback: ${readableProjectXError(error)}`);
  }

  return { contract: null, error: errors.join("; ") || undefined, searchTexts };
}

type ProjectXConnectionRefresh = {
  connection: StoredProjectXConnection;
  error?: string;
};

type ProjectXAccountTarget = {
  account: ProjectXAccount;
  accountConnectionId: string;
  accountGroupName?: string;
  token: string;
};

type ProjectXAccountTargetGroup = {
  accountConnectionId: string;
  accountGroupName?: string;
  targets: ProjectXAccountTarget[];
  token: string;
};

function activeAccounts(connection: StoredProjectXConnection): ProjectXAccount[] {
  const pausedAccountIds = new Set(connection.pausedAccountIds);
  return connection.accounts.filter((account) => account.canTrade && account.isVisible && !pausedAccountIds.has(account.id));
}

function connectionGroupName(connection: StoredProjectXConnection): string | undefined {
  return connection.displayName?.trim() || connection.userName?.trim() || undefined;
}

function orderedConnections(connections: StoredProjectXConnection[]): StoredProjectXConnection[] {
  const preferredId = process.env.PROJECTX_AUTO_TRADE_CONNECTION_ID?.trim();
  if (!preferredId) return connections;
  return [...connections].sort((left, right) => {
    if (left.id === preferredId) return -1;
    if (right.id === preferredId) return 1;
    return 0;
  });
}

function tradeableAccountTargets(refreshes: ProjectXConnectionRefresh[]): ProjectXAccountTarget[] {
  const configuredAccountId = positiveIntegerEnv("PROJECTX_AUTO_TRADE_ACCOUNT_ID");
  const seenAccountIds = new Set<number>();
  const targets: ProjectXAccountTarget[] = [];

  for (const { connection, error } of refreshes) {
    if (error) continue;
    for (const account of activeAccounts(connection)) {
      if (configuredAccountId && account.id !== configuredAccountId) continue;
      if (seenAccountIds.has(account.id)) continue;
      seenAccountIds.add(account.id);
      targets.push({
        account,
        accountConnectionId: connection.id,
        accountGroupName: connectionGroupName(connection),
        token: connection.token
      });
    }
  }

  return targets;
}

function targetGroupsByConnection(targets: ProjectXAccountTarget[]): ProjectXAccountTargetGroup[] {
  const groups = new Map<string, ProjectXAccountTargetGroup>();
  for (const target of targets) {
    const group = groups.get(target.accountConnectionId);
    if (group) {
      group.targets.push(target);
      continue;
    }
    groups.set(target.accountConnectionId, {
      accountConnectionId: target.accountConnectionId,
      accountGroupName: target.accountGroupName,
      targets: [target],
      token: target.token
    });
  }
  return [...groups.values()];
}

function targetOrderBase(
  target: ProjectXAccountTarget,
  fields: Pick<AutoTradeOrderSummary, "contractId" | "contractName"> = {}
): Omit<AutoTradeOrderSummary, "status"> {
  return {
    accountConnectionId: target.accountConnectionId,
    accountGroupName: target.accountGroupName,
    accountId: target.account.id,
    accountBalance: target.account.balance,
    accountName: target.account.name,
    ...fields
  };
}

function failedTargetOrders(
  targets: ProjectXAccountTarget[],
  error: string,
  fields: Pick<AutoTradeOrderSummary, "contractId" | "contractName"> = {}
): AutoTradeOrderSummary[] {
  return targets.map((target) => ({
    ...targetOrderBase(target, fields),
    error,
    status: "failed"
  }));
}

type ProjectXPretradeRiskAdjustment = {
  note?: string;
  size: number;
  skipReason?: string;
};

function topstepAccountSize(account: ProjectXAccount): 50 | 100 | 150 | undefined {
  const text = account.name.trim().toUpperCase();
  if (/(^|[^0-9])150\s*(?:K|,?000)([^0-9]|$)/.test(text)) return 150;
  if (/(^|[^0-9])100\s*(?:K|,?000)([^0-9]|$)/.test(text)) return 100;
  if (/(^|[^0-9])50\s*(?:K|,?000)([^0-9]|$)/.test(text)) return 50;

  const balance = account.balance;
  if (typeof balance !== "number" || !Number.isFinite(balance) || balance <= 0) return undefined;
  if (balance >= 125_000) return 150;
  if (balance >= 75_000) return 100;
  if (balance >= 25_000) return 50;
  return undefined;
}

function projectXContractRootFromText(value: string | undefined): string | undefined {
  const text = value?.trim().toUpperCase();
  if (!text) return undefined;
  const idMatch = text.match(/CON\.F\.US\.([A-Z0-9]+)\.[FGHJKMNQUVXZ]\d{1,2}/);
  if (idMatch?.[1]) return idMatch[1];
  const symbolMatch = text.match(/\b([A-Z0-9]{2,4})[FGHJKMNQUVXZ]\d{1,2}\b/);
  if (symbolMatch?.[1]) return symbolMatch[1];
  const symbolIdMatch = text.match(/F\.US\.([A-Z0-9]{2,4})\b/);
  if (symbolIdMatch?.[1]) return symbolIdMatch[1];
  return undefined;
}

function projectXContractRoot(contract: ProjectXContract, trade?: Pick<TradeAlert, "assetKey" | "symbol">): string | undefined {
  return (
    projectXContractRootFromText(contract.id) ??
    projectXContractRootFromText(contract.name) ??
    projectXContractRootFromText(contract.symbolId) ??
    (trade ? contractSearchTextsForTrade(trade)[0] : undefined)
  );
}

function projectXMiniEquivalentWeight(root: string | undefined): number {
  const normalizedRoot = root?.trim().toUpperCase();
  if (!normalizedRoot) return 1;
  if (normalizedRoot === "SIL") return 0.2;
  if (normalizedRoot === "MBT" || normalizedRoot === "MET") return 1;
  if (STANDARD_MICRO_ROOTS.has(normalizedRoot)) return 0.1;
  if (SPECIAL_MICRO_ROOTS.has(normalizedRoot)) return 0.1;
  return 1;
}

function sameProjectXContractRoot(contractId: string | undefined, root: string | undefined): boolean {
  if (!contractId || !root) return false;
  return projectXContractRootFromText(contractId) === root;
}

function sameSidePositionSize(position: ProjectXOpenPosition, side: ProjectXOrderSide): number {
  const size = typeof position.size === "number" && Number.isFinite(position.size) ? Math.abs(position.size) : 0;
  if (size <= 0) return 0;
  if (side === 0 && position.type === 1) return size;
  if (side === 1 && position.type === 2) return size;
  return 0;
}

function projectXOpenOrderStatusIsWorking(status: ProjectXOpenOrder["status"]): boolean {
  if (status === undefined || status === null) return true;
  if (typeof status === "number") return status === 1 || status === 6;
  return /open|pending/i.test(status);
}

function sameSideWorkingOrderSize(order: ProjectXOpenOrder, side: ProjectXOrderSide): number {
  const size = typeof order.size === "number" && Number.isFinite(order.size) ? Math.abs(order.size) : 0;
  if (size <= 0 || order.side !== side || !projectXOpenOrderStatusIsWorking(order.status)) return 0;
  return size;
}

function formatRiskNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

async function projectXPretradeRiskAdjustment(
  token: string,
  target: ProjectXAccountTarget,
  contract: ProjectXContract,
  trade: TradeAlert,
  side: ProjectXOrderSide,
  plannedSize: number
): Promise<ProjectXPretradeRiskAdjustment> {
  if (!pretradeRiskLookupEnabled()) return { size: plannedSize };

  const accountSize = topstepAccountSize(target.account);
  if (!accountSize) return { size: plannedSize };

  const maxMiniEquivalent = STANDARD_TOPSTEP_MAX_MINIS_BY_ACCOUNT_SIZE[accountSize];
  const root = projectXContractRoot(contract, trade);
  const plannedWeight = projectXMiniEquivalentWeight(root);
  const maxContractUnits = Math.max(1, Math.floor(maxMiniEquivalent / plannedWeight));
  const sideLabel = side === 0 ? "buy/long" : "sell/short";

  try {
    const [positions, openOrders] = await Promise.all([
      searchProjectXOpenPositions(token, target.account.id),
      searchProjectXOpenOrders(token, target.account.id)
    ]);

    let sameSideMiniEquivalent = 0;
    let sameContractUnits = 0;

    for (const position of positions) {
      const size = sameSidePositionSize(position, side);
      if (size <= 0) continue;
      const positionRoot = projectXContractRootFromText(position.contractId);
      sameSideMiniEquivalent += size * projectXMiniEquivalentWeight(positionRoot);
      if (position.contractId === contract.id || sameProjectXContractRoot(position.contractId, root)) sameContractUnits += size;
    }

    for (const order of openOrders) {
      const size = sameSideWorkingOrderSize(order, side);
      if (size <= 0) continue;
      const orderRoot = projectXContractRootFromText(order.contractId);
      sameSideMiniEquivalent += size * projectXMiniEquivalentWeight(orderRoot);
      if (order.contractId === contract.id || sameProjectXContractRoot(order.contractId, root)) sameContractUnits += size;
    }

    const accountRoomUnits = Math.floor(Math.max(0, maxMiniEquivalent - sameSideMiniEquivalent) / plannedWeight);
    const contractRoomUnits = Math.max(0, Math.floor(maxContractUnits - sameContractUnits));
    const safeSize = Math.max(0, Math.min(plannedSize, accountRoomUnits, contractRoomUnits));

    if (safeSize <= 0) {
      const reasons = [
        accountRoomUnits <= 0
          ? `same-side account exposure is ${formatRiskNumber(sameSideMiniEquivalent)} mini-equivalent units against the Topstep ${accountSize}K cap of ${maxMiniEquivalent}`
          : undefined,
        contractRoomUnits <= 0
          ? `${contract.name} ${sideLabel} exposure is ${formatRiskNumber(sameContractUnits)} units against the inferred cap of ${maxContractUnits}`
          : undefined
      ].filter(Boolean);
      return {
        size: 0,
        skipReason: `Skipped before order placement because ${reasons.join("; ")}.`
      };
    }

    if (safeSize < plannedSize) {
      return {
        size: safeSize,
        note: `Placed with ${unitsLabel(safeSize)} because this account needs to have less units under the Topstep ${accountSize}K position cap; planned size was ${unitsLabel(plannedSize)} and current ProjectX exposure leaves ${unitsLabel(safeSize)} available.`
      };
    }
  } catch (error) {
    return {
      size: plannedSize,
      note: `ProjectX preflight exposure lookup failed; trying fallback order sizes: ${readableProjectXError(error)}`
    };
  }

  return { size: plannedSize };
}

function failedRefreshOrders(
  refreshes: ProjectXConnectionRefresh[],
  existingAccountIds: Set<number>,
  fields: Pick<AutoTradeOrderSummary, "contractId" | "contractName"> = {}
): AutoTradeOrderSummary[] {
  const configuredAccountId = positiveIntegerEnv("PROJECTX_AUTO_TRADE_ACCOUNT_ID");
  const failedOrders: AutoTradeOrderSummary[] = [];

  for (const { connection, error } of refreshes) {
    if (!error) continue;
    for (const account of activeAccounts(connection)) {
      if (configuredAccountId && account.id !== configuredAccountId) continue;
      if (existingAccountIds.has(account.id)) continue;
      existingAccountIds.add(account.id);
      failedOrders.push({
        accountConnectionId: connection.id,
        accountGroupName: connectionGroupName(connection),
        accountId: account.id,
        accountBalance: account.balance,
        accountName: account.name,
        ...fields,
        error: `ProjectX connection refresh failed: ${error}`,
        status: "failed"
      });
    }
  }

  return failedOrders;
}

function connectionForOrder(refreshes: ProjectXConnectionRefresh[], order: AutoTradeOrderSummary): ProjectXConnectionRefresh | undefined {
  if (order.accountConnectionId) {
    return refreshes.find((refresh) => refresh.connection.id === order.accountConnectionId);
  }

  return refreshes.find((refresh) => refresh.connection.accounts.some((account) => account.id === order.accountId));
}

function summarizeOrders(
  orders: AutoTradeOrderSummary[],
  fields: Pick<ProjectXAutoTradeResult, "accountName" | "contractId" | "contractName"> = {}
): Omit<ProjectXAutoTradeResult, "checkedAt" | "status"> {
  const first = orders[0];
  const failed = orders.filter((order) => order.status === "failed");
  const skipped = orders.filter((order) => order.status === "skipped");
  const failedError = failed.find((order) => order.error)?.error;
  const skippedError = skipped.find((order) => order.error)?.error;
  const placedNote = orders.find((order) => order.status === "placed" && order.error)?.error;
  return {
    accountId: orders.length === 1 ? first?.accountId : undefined,
    accountName: fields.accountName ?? (orders.length > 1 ? `${orders.length} accounts` : first?.accountName),
    contractId: first?.contractId ?? fields.contractId,
    contractName: first?.contractName ?? fields.contractName,
    customTag: orders.length === 1 ? first?.customTag : undefined,
    error: failed.length
      ? `${failed.length} account(s) failed: ${failed.map((order) => order.accountName ?? order.accountId).join(", ")}${failedError ? ` - ${failedError}` : ""}`
      : skipped.length
        ? `${skipped.length} account(s) skipped: ${skipped.map((order) => order.accountName ?? order.accountId).join(", ")}${
            skippedError ? ` - ${skippedError}` : ""
          }`
        : placedNote,
    orderId: orders.length === 1 ? first?.orderId : undefined,
    orders
  };
}

function isPositionBracketConflict(message: string): boolean {
  return /brackets cannot be used with position brackets|auto oco brackets/i.test(message);
}

function projectXOrderErrorMessage(message: string): string {
  if (/brackets cannot be used with position brackets|auto oco brackets/i.test(message)) {
    return positionBracketFallbackEnabled()
      ? "ProjectX rejected API bracket orders because this account is using Position Brackets. Retried without API bracket fields so ProjectX account-level Position Brackets can manage the exit."
      : "ProjectX rejected bracket orders because this account is using Position Brackets. Enable Auto OCO Brackets in ProjectX risk settings or set PROJECTX_POSITION_BRACKET_FALLBACK_ENABLED=1 to let account-level Position Brackets manage the exit.";
  }
  return message;
}

function positionBracketFallbackRequest(request: ProjectXPlaceOrderRequest): ProjectXPlaceOrderRequest {
  return {
    ...request,
    customTag: request.customTag ? `${request.customTag}_pb` : null,
    stopLossBracket: null,
    takeProfitBracket: null
  };
}

class ProjectXOrderSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectXOrderSkippedError";
  }
}

type ProjectXPlacedOrder = {
  customTag?: string;
  note?: string;
  orderId: number;
};

type ProjectXCustomTagResolution = {
  note?: string;
  orderId?: number;
  retryWithFreshTag?: boolean;
  skipReason?: string;
};

function projectXOrderId(order: Pick<ProjectXOrder, "id" | "orderId">): number | null {
  const id = order.orderId ?? order.id;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

function projectXOrderStatusValue(status: ProjectXOrder["status"]): number | undefined {
  if (typeof status === "number" && Number.isFinite(status)) return status;
  if (typeof status !== "string") return undefined;
  const normalized = status.trim().toLowerCase();
  if (normalized === "open") return 1;
  if (normalized === "filled") return 2;
  if (normalized === "cancelled" || normalized === "canceled") return 3;
  if (normalized === "expired") return 4;
  if (normalized === "rejected") return 5;
  if (normalized === "pending") return 6;
  return undefined;
}

function projectXOrderStatusLabel(status: ProjectXOrder["status"]): string {
  const value = projectXOrderStatusValue(status);
  if (value === 1) return "open";
  if (value === 2) return "filled";
  if (value === 3) return "cancelled";
  if (value === 4) return "expired";
  if (value === 5) return "rejected";
  if (value === 6) return "pending";
  return typeof status === "string" && status.trim() ? status.trim() : "unknown";
}

function projectXOrderStatusIsLive(status: ProjectXOrder["status"]): boolean {
  const value = projectXOrderStatusValue(status);
  return value === 1 || value === 2 || value === 6;
}

function projectXOrderStatusIsTerminal(status: ProjectXOrder["status"]): boolean {
  const value = projectXOrderStatusValue(status);
  return value === 3 || value === 4 || value === 5;
}

function newestProjectXOrderFirst(left: ProjectXOrder, right: ProjectXOrder): number {
  return Date.parse(right.updateTimestamp ?? right.creationTimestamp ?? "") - Date.parse(left.updateTimestamp ?? left.creationTimestamp ?? "");
}

function customTagForFreshRetry(customTag: string): string {
  return `${customTag}_r${Date.now().toString(36).slice(-6)}`;
}

async function resolveProjectXCustomTag(token: string, request: ProjectXPlaceOrderRequest): Promise<ProjectXCustomTagResolution> {
  const customTag = request.customTag?.trim();
  if (!customTag) return {};

  const now = Date.now();
  const matches = (await searchProjectXOrders(token, {
    accountId: request.accountId,
    startTimestamp: new Date(now - projectXDuplicateOrderLookbackMs()).toISOString(),
    endTimestamp: new Date(now + 60_000).toISOString()
  }))
    .filter((order) => order.customTag === customTag)
    .sort(newestProjectXOrderFirst);

  const liveMatch = matches.find((order) => projectXOrderStatusIsLive(order.status) && projectXOrderId(order) !== null);
  if (liveMatch) {
    return {
      note: `Recovered existing ProjectX ${projectXOrderStatusLabel(liveMatch.status)} order with duplicate customTag; no second order was sent.`,
      orderId: projectXOrderId(liveMatch) ?? undefined
    };
  }

  const terminalMatch = matches.find((order) => projectXOrderStatusIsTerminal(order.status));
  if (terminalMatch) {
    return {
      note: `ProjectX customTag already belonged to a ${projectXOrderStatusLabel(terminalMatch.status)} order, so a fresh customTag was used.`,
      retryWithFreshTag: true
    };
  }

  return {
    skipReason: `ProjectX reported customTag ${customTag} is already used, but no matching live order was found in the recent order history. Skipped to avoid a duplicate entry.`
  };
}

async function placeProjectXOrderWithTagRecovery(token: string, request: ProjectXPlaceOrderRequest): Promise<ProjectXPlacedOrder> {
  try {
    const order = await placeProjectXOrder(token, request);
    return {
      customTag: request.customTag ?? undefined,
      orderId: order.orderId
    };
  } catch (error) {
    const rawMessage = readableProjectXError(error);
    const duplicateCustomTag = isProjectXDuplicateCustomTagError(rawMessage);
    const missingOrderId = isMissingProjectXOrderIdError(rawMessage);
    if (!request.customTag || (!duplicateCustomTag && !missingOrderId)) {
      throw error;
    }

    const resolution = await resolveProjectXCustomTag(token, request);
    if (resolution.orderId) {
      return {
        customTag: request.customTag ?? undefined,
        note: resolution.note,
        orderId: resolution.orderId
      };
    }

    if (resolution.retryWithFreshTag && duplicateCustomTag) {
      const retryRequest = {
        ...request,
        customTag: customTagForFreshRetry(request.customTag)
      };
      const retryOrder = await placeProjectXOrder(token, retryRequest);
      return {
        customTag: retryRequest.customTag ?? undefined,
        note: resolution.note,
        orderId: retryOrder.orderId
      };
    }

    if (resolution.skipReason && duplicateCustomTag) throw new ProjectXOrderSkippedError(resolution.skipReason);
    throw error;
  }
}

async function placeProjectXOrderWithAdaptiveFallback(
  token: string,
  request: ProjectXPlaceOrderRequest,
  summaryBase: Omit<AutoTradeOrderSummary, "status">,
  originalSize: number,
  preAdjustmentNote?: string
): Promise<AutoTradeOrderSummary> {
  const attempts = adaptiveSizeFallbackEnabled() ? sizeAttemptSequence(request.size) : [request.size];
  let lastSizeError: string | undefined;
  let lastAttemptSize = request.size;

  for (const attemptSize of attempts) {
    lastAttemptSize = attemptSize;
    const attemptRequest: ProjectXPlaceOrderRequest = {
      ...request,
      customTag: customTagForAttempt(request.customTag ?? "", attemptSize, originalSize),
      size: attemptSize
    };
    const attemptSummary: Omit<AutoTradeOrderSummary, "status"> = {
      ...summaryBase,
      customTag: attemptRequest.customTag ?? undefined,
      size: attemptSize
    };

    try {
      const order = await placeProjectXOrderWithTagRecovery(token, attemptRequest);
      const retryNote = lastSizeError
        ? `Placed with ${unitsLabel(attemptSize)} after ProjectX said this account needs to have less units; planned size was ${unitsLabel(originalSize)}. ${lastSizeError}`
        : preAdjustmentNote;
      return {
        ...attemptSummary,
        customTag: order.customTag ?? attemptSummary.customTag,
        error: [retryNote, order.note].filter(Boolean).join(" ") || undefined,
        orderId: order.orderId,
        status: "placed"
      };
    } catch (error) {
      if (error instanceof ProjectXOrderSkippedError) {
        return {
          ...attemptSummary,
          error: error.message,
          status: "skipped"
        };
      }

      const rawMessage = readableProjectXError(error);
      if (isPositionBracketConflict(rawMessage) && positionBracketFallbackEnabled()) {
        const fallbackRequest = positionBracketFallbackRequest(attemptRequest);
        const fallbackSummary: Omit<AutoTradeOrderSummary, "status"> = {
          ...attemptSummary,
          customTag: fallbackRequest.customTag ?? undefined
        };
        try {
          const fallbackOrder = await placeProjectXOrderWithTagRecovery(token, fallbackRequest);
          const retryNote = lastSizeError
            ? `Placed with ${unitsLabel(attemptSize)} after ProjectX said this account needs to have less units; planned size was ${unitsLabel(originalSize)}. Placed via Position Brackets fallback; API TP/SL ticks were not attached. Previous rejection: ${lastSizeError}`
            : "Placed via ProjectX Position Brackets fallback. Exit protection is managed by the account-level Position Bracket settings; API TP/SL ticks were not attached.";
          return {
            ...fallbackSummary,
            customTag: fallbackOrder.customTag ?? fallbackSummary.customTag,
            error: [preAdjustmentNote && !lastSizeError ? preAdjustmentNote : undefined, retryNote, fallbackOrder.note].filter(Boolean).join(" "),
            orderId: fallbackOrder.orderId,
            status: "placed"
          };
        } catch (fallbackError) {
          if (fallbackError instanceof ProjectXOrderSkippedError) {
            return {
              ...fallbackSummary,
              error: fallbackError.message,
              status: "skipped"
            };
          }

          const fallbackRawMessage = readableProjectXError(fallbackError);
          if (projectXSkippableOrderError(fallbackRawMessage)) {
            return {
              ...fallbackSummary,
              error: fallbackRawMessage,
              status: "skipped"
            };
          }
          if (attemptSize > 1 && isSizeReducibleProjectXError(fallbackRawMessage)) {
            lastSizeError = fallbackRawMessage;
            continue;
          }
          const message = `${projectXOrderErrorMessage(rawMessage)} Fallback failed: ${fallbackRawMessage}`;
          return {
            ...fallbackSummary,
            error: message,
            status: "failed"
          };
        }
      }

      const message = projectXOrderErrorMessage(rawMessage);
      if (projectXSkippableOrderError(rawMessage)) {
        return {
          ...attemptSummary,
          error: message,
          status: "skipped"
        };
      }
      if (attemptSize > 1 && isSizeReducibleProjectXError(rawMessage)) {
        lastSizeError = message;
        continue;
      }
      return {
        ...attemptSummary,
        error: message,
        status: "failed"
      };
    }
  }

  return {
    ...summaryBase,
    customTag: customTagForAttempt(request.customTag ?? "", lastAttemptSize, originalSize),
    error: lastSizeError
      ? `ProjectX rejected every fallback order size from ${unitsLabel(originalSize)} through ${unitsLabel(lastAttemptSize)}; this account may need to have less units: ${lastSizeError}`
      : "ProjectX order placement failed after fallback order-size attempts.",
    size: lastAttemptSize,
    status: "failed"
  };
}

async function refreshedConnections(): Promise<ProjectXConnectionRefresh[]> {
  const connections = orderedConnections(await getStoredProjectXConnections());
  return Promise.all(
    connections.map(async (connection): Promise<ProjectXConnectionRefresh> => {
      let activeToken = connection.token;
      let validateError: string | undefined;
      try {
        const refreshedToken = await validateProjectXSession(connection.token);
        activeToken = refreshedToken ?? connection.token;
      } catch (error) {
        validateError = readableProjectXError(error);
      }

      try {
        let accounts: ProjectXAccount[];
        try {
          accounts = await searchProjectXAccounts(activeToken, true);
        } catch (accountError) {
          if (activeToken === connection.token) throw accountError;
          try {
            activeToken = connection.token;
            accounts = await searchProjectXAccounts(connection.token, true);
          } catch (storedTokenError) {
            throw new Error(`${readableProjectXError(accountError)}; stored-token fallback failed: ${readableProjectXError(storedTokenError)}`);
          }
        }

        const visibleAccounts = accounts.filter((account) => !(connection.removedAccountIds ?? []).includes(account.id));
        return {
          connection: await saveStoredProjectXConnection({
            accessCodeHash: connection.accessCodeHash,
            accounts: visibleAccounts,
            autoTradePaused: connection.autoTradePaused,
            connectedAt: connection.connectedAt,
            displayName: connection.displayName,
            id: connection.id,
            pausedAccountIds: connection.pausedAccountIds,
            removedAccountIds: connection.removedAccountIds,
            token: activeToken,
            userName: connection.userName
          })
        };
      } catch (error) {
        const accountError = readableProjectXError(error);
        if (validateError) {
          await markStoredProjectXConnectionExpired(connection.id).catch(() => null);
        }
        return {
          connection,
          error: validateError
            ? `ProjectX session validate failed: ${validateError}; account search fallback failed: ${accountError}`
            : accountError
        };
      }
    })
  );
}

function eventManagementPrice(event: TradeManagementEvent): number {
  return event.type === "edit_sl"
    ? event.stopLossPrice ?? event.price
    : event.type === "edit_tp"
      ? event.takeProfitPrice ?? event.price
      : event.entryPrice ?? event.price;
}

function orderSummaryStatus(status: TradeAlert["autoTradeStatus"]): AutoTradeOrderSummary["status"] | null {
  if (status === "dry_run" || status === "failed" || status === "placed" || status === "skipped") return status;
  return null;
}

function singleOrderSummaryFromTrade(trade: TradeAlert, limitOrder: boolean): AutoTradeOrderSummary | null {
  const accountId = limitOrder ? trade.limitOrderAutoTradeOrderId && trade.autoTradeAccountId : trade.autoTradeAccountId;
  const orderId = limitOrder ? trade.limitOrderAutoTradeOrderId : trade.autoTradeOrderId;
  const status = orderSummaryStatus(limitOrder ? trade.limitOrderAutoTradeStatus : trade.autoTradeStatus);
  if (!accountId || !orderId || !status) return null;
  return {
    accountId,
    accountName: trade.autoTradeAccountName,
    contractId: limitOrder ? trade.limitOrderAutoTradeContractId : trade.autoTradeContractId,
    contractName: limitOrder ? trade.limitOrderAutoTradeContractName : trade.autoTradeContractName,
    customTag: limitOrder ? trade.limitOrderAutoTradeCustomTag : trade.autoTradeCustomTag,
    orderId,
    size: trade.sizeMultiplier,
    status
  };
}

function managementSourceOrders(trade: TradeAlert, event: TradeManagementEvent): AutoTradeOrderSummary[] {
  const limitOrders = trade.limitOrderAutoTradeOrders?.length
    ? trade.limitOrderAutoTradeOrders
    : [singleOrderSummaryFromTrade(trade, true)].filter((order): order is AutoTradeOrderSummary => Boolean(order));
  const primaryOrders = trade.autoTradeOrders?.length
    ? trade.autoTradeOrders
    : [singleOrderSummaryFromTrade(trade, false)].filter((order): order is AutoTradeOrderSummary => Boolean(order));
  const preferredOrders = event.type === "edit_limit" && limitOrders.length ? limitOrders : primaryOrders;
  return preferredOrders.filter((order) => order.status === "placed" || order.status === "dry_run");
}

function openOrderId(order: ProjectXOpenOrder): number | null {
  return projectXOrderId(order);
}

function openOrderTypeMatches(event: TradeManagementEvent, order: ProjectXOpenOrder): boolean {
  if (event.type === "edit_sl") return order.type === 4 || order.type === 5;
  if (event.type === "edit_tp") return order.type === 1;
  return order.type === 1;
}

function openOrderSideMatches(trade: TradeAlert, event: TradeManagementEvent, order: ProjectXOpenOrder): boolean {
  const entrySide: ProjectXOrderSide = trade.side === "long" ? 0 : 1;
  const exitSide: ProjectXOrderSide = trade.side === "long" ? 1 : 0;
  return order.side === (event.type === "edit_limit" ? entrySide : exitSide);
}

function matchingOpenOrders(
  trade: TradeAlert,
  event: TradeManagementEvent,
  summary: AutoTradeOrderSummary,
  openOrders: ProjectXOpenOrder[]
): ProjectXOpenOrder[] {
  let candidates = openOrders.filter(
    (order) =>
      openOrderId(order) !== null &&
      openOrderTypeMatches(event, order) &&
      openOrderSideMatches(trade, event, order) &&
      (!summary.contractId || order.contractId === summary.contractId)
  );

  if (summary.customTag) {
    const tagged = candidates.filter((order) => order.customTag === summary.customTag);
    if (tagged.length) candidates = tagged;
  }

  const checkedAt = Date.parse(trade.autoTradeCheckedAt ?? "");
  if (Number.isFinite(checkedAt)) {
    const recent = candidates.filter((order) => {
      const createdAt = Date.parse(order.creationTimestamp ?? "");
      return !Number.isFinite(createdAt) || createdAt >= checkedAt - 15 * 60_000;
    });
    if (recent.length) candidates = recent;
  }

  if (typeof summary.size === "number" && Number.isFinite(summary.size)) {
    const sameSize = candidates.filter((order) => typeof order.size !== "number" || Math.round(order.size) === Math.round(summary.size ?? 0));
    if (sameSize.length) candidates = sameSize;
  }

  return candidates;
}

function managementModifyPayload(
  accountId: number,
  orderId: number,
  size: number | undefined,
  event: TradeManagementEvent
) {
  const price = eventManagementPrice(event);
  return {
    accountId,
    orderId,
    size: typeof size === "number" && Number.isFinite(size) && size > 0 ? Math.round(size) : undefined,
    limitPrice: event.type === "edit_tp" || event.type === "edit_limit" ? price : null,
    stopPrice: event.type === "edit_sl" ? price : null,
    trailPrice: null
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function projectXTradeNetPnl(trade: ProjectXTrade): { fees: number; gross: number; net: number } | null {
  const gross = finiteNumber(trade.profitAndLoss);
  if (gross === undefined) return null;
  const fees = finiteNumber(trade.fees) ?? 0;
  return {
    fees,
    gross,
    net: gross - fees
  };
}

function projectXTradeResultWindow(trade: TradeAlert): { endTimestamp: string; startTimestamp: string } {
  const startMs = Date.parse(trade.autoTradeCheckedAt ?? trade.signalTime);
  const endMs = Date.parse(trade.lifecycleTime ?? "");
  const now = Date.now();
  const resolvedStartMs = (Number.isFinite(startMs) ? startMs : now) - PROJECTX_TRADE_RESULT_LOOKBACK_MS;
  const minimumEndMs = Number.isFinite(endMs) ? endMs + PROJECTX_TRADE_RESULT_LOOKAHEAD_MS : now + 60_000;
  const maxEndMs = resolvedStartMs + projectXTradeResultMaxLookaheadMs();
  return {
    startTimestamp: new Date(resolvedStartMs).toISOString(),
    endTimestamp: new Date(Math.min(Math.max(minimumEndMs, now + 60_000), maxEndMs)).toISOString()
  };
}

function matchingProjectXClosedTrade(
  trades: ProjectXTrade[],
  order: AutoTradeOrderSummary,
  lifecycleTime: string | undefined
): ProjectXTrade | null {
  const lifecycleMs = Date.parse(lifecycleTime ?? "");
  const candidates = trades.filter((trade) => {
    if (trade.voided) return false;
    if (projectXTradeNetPnl(trade) === null) return false;
    if (order.contractId && trade.contractId !== order.contractId) return false;
    if (typeof order.size === "number" && Number.isFinite(order.size) && typeof trade.size === "number" && Math.round(trade.size) !== Math.round(order.size)) {
      return false;
    }
    return true;
  });

  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => {
    const leftTime = Date.parse(left.creationTimestamp ?? "");
    const rightTime = Date.parse(right.creationTimestamp ?? "");
    if (Number.isFinite(lifecycleMs)) {
      const leftDistance = Number.isFinite(leftTime) ? Math.abs(leftTime - lifecycleMs) : Number.POSITIVE_INFINITY;
      const rightDistance = Number.isFinite(rightTime) ? Math.abs(rightTime - lifecycleMs) : Number.POSITIVE_INFINITY;
      return leftDistance - rightDistance;
    }
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  })[0] ?? null;
}

function orderHasProjectXResult(order: AutoTradeOrderSummary): boolean {
  return typeof order.netPnlDollars === "number" && Number.isFinite(order.netPnlDollars);
}

function projectXResolvedLifecycleFields(
  trade: TradeAlert,
  resultOrders: AutoTradeOrderSummary[],
  netPnl: number
): Pick<TradeAlert, "lifecyclePnlDollars" | "lifecycleRMultiple" | "lifecycleStatus"> {
  const tradedSize = resultOrders.reduce(
    (sum, order) => sum + (typeof order.size === "number" && Number.isFinite(order.size) ? Math.abs(order.size) : 0),
    0
  );
  const riskDollars = Math.abs(trade.slUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * tradedSize);
  const resolvedStatus =
    netPnl > 0 ? "take_profit" : netPnl < 0 ? "stop_loss" : trade.lifecycleStatus;

  return {
    lifecyclePnlDollars: netPnl,
    lifecycleRMultiple: riskDollars > 0 ? netPnl / riskDollars : trade.lifecycleRMultiple,
    lifecycleStatus: resolvedStatus
  };
}

async function waitForProjectXTestPosition(token: string, accountId: number, contractId: string): Promise<boolean> {
  for (let attempt = 0; attempt < PROJECTX_TEST_CLOSE_ATTEMPTS; attempt += 1) {
    const positions = await searchProjectXOpenPositions(token, accountId);
    if (positions.some((position) => position.contractId === contractId && Math.abs(position.size ?? 0) > 0)) return true;
    await wait(PROJECTX_TEST_CLOSE_WAIT_MS);
  }
  return false;
}

export async function enrichProjectXTradeOutcome(trade: TradeAlert): Promise<TradeAlert> {
  const orders = trade.autoTradeOrders;
  if (!orders?.some((order) => order.status === "placed")) return trade;

  const connectionRefreshes = await refreshedConnections();
  if (!connectionRefreshes.length) {
    const resultCheckedAt = new Date().toISOString();
    return {
      ...trade,
      autoTradeOrders: orders.map((order) =>
        order.status === "placed" ? { ...order, resultCheckedAt, resultError: "ProjectX connection not found." } : order
      )
    };
  }

  const window = projectXTradeResultWindow(trade);
  const resultCheckedAt = new Date().toISOString();
  const enrichedOrders = await Promise.all(
    orders.map(async (order): Promise<AutoTradeOrderSummary> => {
      if (order.status !== "placed") return order;
      const sourceConnection = connectionForOrder(connectionRefreshes, order);
      if (!sourceConnection) return { ...order, resultCheckedAt, resultError: "ProjectX connection not found." };
      if (sourceConnection.error) return { ...order, resultCheckedAt, resultError: `ProjectX connection refresh failed: ${sourceConnection.error}` };

      try {
        const accountTrades = await searchProjectXTrades(sourceConnection.connection.token, {
          accountId: order.accountId,
          ...window
        });
        const resultTrade = matchingProjectXClosedTrade(accountTrades, order, trade.lifecycleTime);
        const pnl = resultTrade ? projectXTradeNetPnl(resultTrade) : null;
        if (!resultTrade || !pnl) return { ...order, resultCheckedAt, resultError: "Topstep result pending." };
        return {
          ...order,
          feesDollars: pnl.fees,
          grossPnlDollars: pnl.gross,
          netPnlDollars: pnl.net,
          resultCheckedAt,
          resultError: undefined,
          resultTradeId: resultTrade.id
        };
      } catch (error) {
        return { ...order, resultCheckedAt, resultError: readableProjectXError(error) };
      }
    })
  );

  const placedOrders = enrichedOrders.filter((order) => order.status === "placed");
  const resultOrders = placedOrders.filter(orderHasProjectXResult);
  const allPlacedOrdersResolved = placedOrders.length > 0 && resultOrders.length === placedOrders.length;
  const netPnl = resultOrders.reduce((sum, order) => sum + (order.netPnlDollars ?? 0), 0);
  const resolvedLifecycleFields = allPlacedOrdersResolved
    ? projectXResolvedLifecycleFields(trade, resultOrders, netPnl)
    : {};

  return {
    ...trade,
    autoTradeOrders: enrichedOrders,
    ...resolvedLifecycleFields
  };
}

export async function executeProjectXManagementTrade(trade: TradeAlert, event: TradeManagementEvent): Promise<ProjectXAutoTradeResult> {
  if (!projectXAutoTradingEnabled()) {
    return result("disabled", { error: "PROJECTX_AUTO_TRADE_ENABLED is disabled." });
  }

  if (trade.market !== "futures") {
    return result("skipped", { error: "ProjectX management is only enabled for futures signals." });
  }

  try {
    const sourceOrders = managementSourceOrders(trade, event);
    if (!sourceOrders.length) {
      return result("skipped", { error: "No placed ProjectX order metadata was stored for this trade." });
    }

    const connectionRefreshes = await refreshedConnections();
    if (!connectionRefreshes.length) return result("skipped", { error: "No TopstepX ProjectX connection is available." });

    const orders: AutoTradeOrderSummary[] = [];
    for (const sourceOrder of sourceOrders) {
      if (sourceOrder.status === "dry_run" || dryRunEnabled()) {
        orders.push({
          ...sourceOrder,
          error: "Dry run: ProjectX order modification was not sent.",
          status: "dry_run"
        });
        continue;
      }

      const sourceConnection = connectionForOrder(connectionRefreshes, sourceOrder);
      if (!sourceConnection) {
        orders.push({
          ...sourceOrder,
          error: "ProjectX connection for this account is no longer active.",
          status: "failed"
        });
        continue;
      }
      if (sourceConnection.error) {
        orders.push({
          ...sourceOrder,
          error: `ProjectX connection refresh failed: ${sourceConnection.error}`,
          status: "failed"
        });
        continue;
      }

      if (event.type === "edit_limit" && sourceOrder.orderId) {
        try {
          await modifyProjectXOrder(
            sourceConnection.connection.token,
            managementModifyPayload(sourceOrder.accountId, sourceOrder.orderId, sourceOrder.size, event)
          );
          orders.push({ ...sourceOrder, status: "placed" });
        } catch (error) {
          orders.push({ ...sourceOrder, error: readableProjectXError(error), status: "failed" });
        }
        continue;
      }

      let openOrders: ProjectXOpenOrder[];
      try {
        openOrders = await searchProjectXOpenOrders(sourceConnection.connection.token, sourceOrder.accountId);
      } catch (error) {
        orders.push({
          ...sourceOrder,
          error: `ProjectX open-order lookup failed: ${readableProjectXError(error)}`,
          status: "failed"
        });
        continue;
      }

      const matches = matchingOpenOrders(trade, event, sourceOrder, openOrders);
      if (matches.length !== 1) {
        orders.push({
          ...sourceOrder,
          error: matches.length
            ? `Found ${matches.length} matching ProjectX open orders; skipped to avoid modifying the wrong order.`
            : "No matching ProjectX open order was found for this managed TP/SL.",
          status: "skipped"
        });
        continue;
      }

      const match = matches[0]!;
      const orderId = openOrderId(match);
      if (orderId == null) {
        orders.push({ ...sourceOrder, error: "Matched ProjectX order did not include an order id.", status: "failed" });
        continue;
      }

      try {
        await modifyProjectXOrder(
          sourceConnection.connection.token,
          managementModifyPayload(sourceOrder.accountId, orderId, match.size ?? sourceOrder.size, event)
        );
        orders.push({
          ...sourceOrder,
          orderId,
          status: "placed"
        });
      } catch (error) {
        orders.push({
          ...sourceOrder,
          orderId,
          error: readableProjectXError(error),
          status: "failed"
        });
      }
    }

    const actionableOrders = orders.filter((order) => order.status !== "skipped");
    const placedOrders = orders.filter((order) => order.status === "placed");
    if (!actionableOrders.length) return result("skipped", summarizeOrders(orders));
    if (orders.some((order) => order.status === "dry_run")) return result("dry_run", summarizeOrders(orders));
    if (placedOrders.length) return result("placed", summarizeOrders(orders));
    return result("failed", summarizeOrders(orders));
  } catch (error) {
    return result("failed", { error: readableProjectXError(error) });
  }
}

export async function executeProjectXTestTrade(input: { accountId: number; connectionId: string }): Promise<ProjectXAutoTradeResult> {
  if (!projectXAutoTradingEnabled()) {
    return result("disabled", { error: "PROJECTX_AUTO_TRADE_ENABLED is disabled." });
  }

  if (!dryRunEnabled()) {
    const sessionBlockReason = topstepExecutionSessionBlockReason();
    if (sessionBlockReason) return result("skipped", { error: sessionBlockReason });
  }

  try {
    const connectionRefreshes = await refreshedConnections();
    const targetRefresh = connectionRefreshes.find((refresh) => refresh.connection.id === input.connectionId);
    if (!targetRefresh) {
      return result("skipped", { error: "ProjectX account folder is no longer connected." });
    }

    const account = targetRefresh.connection.accounts.find((item) => item.id === input.accountId);
    if (!account) {
      return result("skipped", { error: "ProjectX account was not found in this folder." });
    }

    const orderBase: Omit<AutoTradeOrderSummary, "status"> = {
      accountBalance: account.balance,
      accountConnectionId: targetRefresh.connection.id,
      accountGroupName: connectionGroupName(targetRefresh.connection),
      accountId: account.id,
      accountName: account.name
    };

    if (targetRefresh.error) {
      return result("failed", {
        error: `ProjectX connection refresh failed: ${targetRefresh.error}`,
        orders: [
          {
            ...orderBase,
            error: `ProjectX connection refresh failed: ${targetRefresh.error}`,
            status: "failed"
          }
        ]
      });
    }

    if (!account.canTrade || !account.isVisible) {
      const error = "ProjectX account is not tradeable or visible.";
      return result("skipped", { error, orders: [{ ...orderBase, error, status: "skipped" }] });
    }

    if (new Set(targetRefresh.connection.pausedAccountIds).has(account.id)) {
      const error = "ProjectX account is paused. Resume it before testing live execution.";
      return result("skipped", { error, orders: [{ ...orderBase, error, status: "skipped" }] });
    }

    const trade = await buildAutoTradeTestTrade("futures", "projectx", account.id, { useStoredPrice: false });
    let contractLookup: ProjectXContractLookup;
    try {
      contractLookup = await projectXContractForTrade(targetRefresh.connection.token, trade);
    } catch (error) {
      const message = readableProjectXError(error);
      return result("failed", { error: message, orders: [{ ...orderBase, error: message, status: "failed" }] });
    }
    const contract = contractLookup.contract;
    if (!contract) {
      const error = `No ProjectX contract found for ${contractLookup.searchTexts.join(", ")}.${
        contractLookup.error ? ` Lookup errors: ${contractLookup.error}` : ""
      }`;
      return result("failed", { error, orders: [{ ...orderBase, error, status: "failed" }] });
    }

    const contractFields = { contractId: contract.id, contractName: contract.name };
    let baseSize: number;
    try {
      baseSize = positiveNumber(trade.sizeMultiplier ?? 1, "Order size");
    } catch (error) {
      const message = readableProjectXError(error);
      return result("failed", { error: message, orders: [{ ...orderBase, ...contractFields, error: message, status: "failed" }] });
    }
    const size = projectXOrderSizeForAccount(trade, account, baseSize);
    const customTag = customTagForTrade(trade, account.id);
    const summaryBase: Omit<AutoTradeOrderSummary, "status"> = {
      ...orderBase,
      ...contractFields,
      customTag,
      size
    };

    if (size <= 0) {
      const error = "Test order skipped because the account-scaled size is below 1 contract.";
      return result("skipped", { error, orders: [{ ...summaryBase, error, status: "skipped" }] });
    }

    let stopLossTicks: number;
    let takeProfitTicks: number;
    try {
      ({ stopLossTicks, takeProfitTicks } = projectXBracketTicksForTrade(trade));
    } catch (error) {
      const message = readableProjectXError(error);
      return result("failed", { error: message, orders: [{ ...summaryBase, error: message, status: "failed" }] });
    }
    const entryType: ProjectXOrderType = trade.entryType === "limit" ? 1 : 2;
    const side: ProjectXOrderSide = trade.side === "long" ? 0 : 1;
    const request: ProjectXPlaceOrderRequest = {
      accountId: account.id,
      contractId: contract.id,
      customTag,
      limitPrice: entryType === 1 ? trade.entryPrice : null,
      side,
      size,
      stopLossBracket: {
        ticks: stopLossTicks,
        type: 4 as ProjectXOrderType
      },
      stopPrice: null,
      takeProfitBracket: {
        ticks: takeProfitTicks,
        type: 1 as ProjectXOrderType
      },
      trailPrice: null,
      type: entryType
    };

    if (dryRunEnabled()) {
      return result("dry_run", summarizeOrders([{ ...summaryBase, status: "dry_run" }], contractFields));
    }

    const placedOrder = await placeProjectXOrderWithAdaptiveFallback(
      targetRefresh.connection.token,
      request,
      summaryBase,
      size
    );
    if (placedOrder.status !== "placed") {
      return result(placedOrder.status, summarizeOrders([placedOrder], contractFields));
    }

    try {
      const positionOpened = await waitForProjectXTestPosition(targetRefresh.connection.token, account.id, contract.id);
      if (!positionOpened) {
        const closeWarning = "Test order was placed with TP/SL, but no open position was found to close.";
        return result("failed", {
          ...summarizeOrders([{ ...placedOrder, error: closeWarning }], contractFields),
          error: closeWarning
        });
      }
      await closeProjectXPosition(targetRefresh.connection.token, {
        accountId: account.id,
        contractId: contract.id
      });
    } catch (closeError) {
      const message = `Test order was placed with TP/SL, but closing it failed: ${readableProjectXError(closeError)}`;
      return result("failed", {
        ...summarizeOrders([{ ...placedOrder, error: message }], contractFields),
        error: message
      });
    }

    return result("placed", {
      ...summarizeOrders([placedOrder], contractFields),
      testMessage: "Success: opened with TP/SL and closed",
      testStatus: "success"
    });
  } catch (error) {
    return result("failed", { error: readableProjectXError(error) });
  }
}

export async function executeProjectXAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  if (!projectXAutoTradingEnabled()) {
    return result("disabled", { error: "PROJECTX_AUTO_TRADE_ENABLED is disabled." });
  }

  if (trade.market !== "futures") {
    return result("skipped", { error: "ProjectX auto trading is only enabled for futures signals." });
  }

  if (!dryRunEnabled()) {
    const sessionBlockReason = topstepExecutionSessionBlockReason();
    if (sessionBlockReason) return result("skipped", { error: sessionBlockReason });
  }

  try {
    const connectionRefreshes = await refreshedConnections();
    if (!connectionRefreshes.length) return result("skipped", { error: NO_ACTIVE_AUTO_TRADE_ACCOUNTS });

    const accountTargets = tradeableAccountTargets(connectionRefreshes);
    const failedConnectionOrders = failedRefreshOrders(
      connectionRefreshes,
      new Set(accountTargets.map((target) => target.account.id))
    );
    if (!accountTargets.length) {
      if (failedConnectionOrders.length) return result("failed", summarizeOrders(failedConnectionOrders));
      return result("skipped", {
        error: positiveIntegerEnv("PROJECTX_AUTO_TRADE_ACCOUNT_ID") ? "Configured PROJECTX_AUTO_TRADE_ACCOUNT_ID was not found or is paused." : NO_ACTIVE_AUTO_TRADE_ACCOUNTS
      });
    }

    const entryType: ProjectXOrderType = trade.entryType === "limit" ? 1 : 2;
    const side: ProjectXOrderSide = trade.side === "long" ? 0 : 1;
    const orders: AutoTradeOrderSummary[] = [...failedConnectionOrders];
    let baseSize: number;
    let stopLossTicks: number;
    let takeProfitTicks: number;
    try {
      baseSize = positiveNumber(trade.sizeMultiplier ?? 1, "Order size");
      ({ stopLossTicks, takeProfitTicks } = projectXBracketTicksForTrade(trade));
    } catch (error) {
      const message = readableProjectXError(error);
      return result("failed", summarizeOrders([...orders, ...failedTargetOrders(accountTargets, message)]));
    }

    const recentTrades = adaptiveSizeFallbackEnabled() ? await getTrades().catch(() => [] as TradeAlert[]) : undefined;
    for (const group of targetGroupsByConnection(accountTargets)) {
      let contractLookup: ProjectXContractLookup;
      try {
        contractLookup = await projectXContractForTrade(group.token, trade);
      } catch (error) {
        orders.push(...failedTargetOrders(group.targets, `ProjectX contract lookup failed for ${group.accountGroupName ?? "account folder"}: ${readableProjectXError(error)}`));
        continue;
      }

      const contract = contractLookup.contract;
      if (!contract) {
        orders.push(
          ...failedTargetOrders(
            group.targets,
            `No ProjectX contract found for ${contractLookup.searchTexts.join(", ")}.${
              contractLookup.error ? ` Lookup errors: ${contractLookup.error}` : ""
            }`
          )
        );
        continue;
      }

      const contractFields = { contractId: contract.id, contractName: contract.name };
      for (const target of group.targets) {
        const account = target.account;
        const originalSize = projectXOrderSizeForAccount(trade, account, baseSize);
        const customTag = customTagForTrade(trade, account.id);
        const orderBase = {
          ...targetOrderBase(target, contractFields),
          customTag
        };
        if (originalSize <= 0) {
          orders.push({
            ...orderBase,
            error:
              trade.orderLeg === "limit"
                ? "Limit leg skipped because the account-scaled total size leaves no remaining contract after the entry leg."
                : "Order skipped because the account-scaled size is below 1 contract.",
            size: originalSize,
            status: "skipped"
          });
          continue;
        }

        let size = originalSize;
        let adjustmentNote: string | undefined;
        const recentFailure = await recentProjectXSizeFailureCap(account.id, trade, contract, recentTrades);
        if (recentFailure && recentFailure.size <= size) {
          if (recentFailure.size <= 1) {
            orders.push({
              ...orderBase,
              error: `Skipped because this account recently needed to have less units at 1 unit: ${recentFailure.reason}`,
              size: 1,
              status: "skipped"
            });
            continue;
          }
          size = Math.max(1, Math.min(size, recentFailure.size - 1));
          adjustmentNote = `Started with ${unitsLabel(size)} instead of ${unitsLabel(originalSize)} because this account recently needed to have less units at ${unitsLabel(recentFailure.size)}: ${recentFailure.reason}`;
        }

        const preflight = await projectXPretradeRiskAdjustment(group.token, target, contract, trade, side, size);
        if (preflight.skipReason) {
          orders.push({
            ...orderBase,
            error: preflight.skipReason,
            size,
            status: "skipped"
          });
          continue;
        }
        if (preflight.note) {
          adjustmentNote = [adjustmentNote, preflight.note].filter(Boolean).join(" ");
        }
        size = preflight.size;

        const request: ProjectXPlaceOrderRequest = {
          accountId: account.id,
          contractId: contract.id,
          customTag,
          limitPrice: entryType === 1 ? trade.entryPrice : null,
          side,
          size,
          stopLossBracket: {
            ticks: stopLossTicks,
            type: 4 as ProjectXOrderType
          },
          stopPrice: null,
          takeProfitBracket: {
            ticks: takeProfitTicks,
            type: 1 as ProjectXOrderType
          },
          trailPrice: null,
          type: entryType
        };

        if (dryRunEnabled()) {
          orders.push({
            ...orderBase,
            error: adjustmentNote,
            size,
            status: "dry_run"
          });
          continue;
        }

        orders.push(await placeProjectXOrderWithAdaptiveFallback(group.token, request, { ...orderBase, size }, originalSize, adjustmentNote));
      }
    }

    const placedOrders = orders.filter((order) => order.status === "placed");
    const actionableOrders = orders.filter((order) => order.status !== "skipped");
    if (!actionableOrders.length) return result("skipped", summarizeOrders(orders));
    if (dryRunEnabled()) return result("dry_run", summarizeOrders(orders));
    if (placedOrders.length) return result("placed", summarizeOrders(orders));
    return result("failed", summarizeOrders(orders));
  } catch (error) {
    return result("failed", { error: readableProjectXError(error) });
  }
}
