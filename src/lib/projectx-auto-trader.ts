import { createHash } from "node:crypto";
import { assetForKey, assetForSymbol, assetLookupSymbolForSymbol } from "@/lib/assets";
import { buildAutoTradeTestTrade } from "@/lib/auto-trade-test";
import { scaledAutoTradeSize } from "@/lib/auto-trade-utils";
import {
  getStoredProjectXConnections,
  saveStoredProjectXConnection,
  type StoredProjectXConnection
} from "@/lib/projectx-connections";
import {
  modifyProjectXOrder,
  placeProjectXOrder,
  readableProjectXError,
  searchProjectXOpenOrders,
  searchProjectXAccounts,
  searchProjectXContracts,
  searchProjectXTrades,
  validateProjectXSession,
  type ProjectXAccount,
  type ProjectXContract,
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

function result(status: ProjectXAutoTradeStatus, fields: Omit<ProjectXAutoTradeResult, "checkedAt" | "status"> = {}): ProjectXAutoTradeResult {
  return {
    checkedAt: new Date().toISOString(),
    status,
    ...fields
  };
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

function projectXOrderSizeForAccount(trade: TradeAlert, account: ProjectXAccount, fallbackBaseSize: number): number {
  if ((trade.orderLeg === "entry" || trade.orderLeg === "limit") && typeof trade.splitOrderTotalSizeMultiplier === "number") {
    const totalSize = scaledAutoTradeSize(trade.splitOrderTotalSizeMultiplier, account, { minSize: 0, wholeNumber: true });
    if (totalSize <= 0) return 0;
    const entrySize = Math.ceil(totalSize * 0.5);
    return trade.orderLeg === "entry" ? entrySize : Math.max(0, totalSize - entrySize);
  }

  return scaledAutoTradeSize(fallbackBaseSize, account, { minSize: 0, wholeNumber: true });
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

  const stopLossTicks = wholeNumber(Math.abs(trade.slUnits), "Stop-loss ticks");
  const takeProfitTicks = wholeNumber(Math.abs(trade.tpUnits), "Take-profit ticks");
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

async function projectXContractForTrade(
  token: string,
  trade: TradeAlert
): Promise<{ contract: ProjectXContract | null; searchTexts: string[]; selectedSearchText?: string }> {
  const searchTexts = contractSearchTextsForTrade(trade);
  for (const searchText of searchTexts) {
    const contract = bestContract(await searchProjectXContracts(token, searchText, projectXContractLiveFlag()), searchText);
    if (contract) return { contract, searchTexts, selectedSearchText: searchText };
  }
  return { contract: null, searchTexts };
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

async function refreshedConnections(): Promise<ProjectXConnectionRefresh[]> {
  const connections = orderedConnections(await getStoredProjectXConnections());
  return Promise.all(
    connections.map(async (connection): Promise<ProjectXConnectionRefresh> => {
      try {
        const refreshedToken = await validateProjectXSession(connection.token);
        const activeToken = refreshedToken ?? connection.token;
        const accounts = await searchProjectXAccounts(activeToken, true);
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
        return {
          connection,
          error: readableProjectXError(error)
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
  const id = order.orderId ?? order.id;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
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
  return {
    startTimestamp: new Date((Number.isFinite(startMs) ? startMs : now) - PROJECTX_TRADE_RESULT_LOOKBACK_MS).toISOString(),
    endTimestamp: new Date((Number.isFinite(endMs) ? endMs : now) + PROJECTX_TRADE_RESULT_LOOKAHEAD_MS).toISOString()
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

  return {
    ...trade,
    autoTradeOrders: enrichedOrders,
    lifecyclePnlDollars: allPlacedOrdersResolved ? netPnl : trade.lifecyclePnlDollars
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

      const openOrders = await searchProjectXOpenOrders(sourceConnection.connection.token, sourceOrder.accountId);
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
    const contractLookup = await projectXContractForTrade(targetRefresh.connection.token, trade);
    const contract = contractLookup.contract;
    if (!contract) return result("failed", { error: `No ProjectX contract found for ${contractLookup.searchTexts.join(", ")}.` });

    const baseSize = positiveNumber(trade.sizeMultiplier ?? 1, "Order size");
    const size = projectXOrderSizeForAccount(trade, account, baseSize);
    const customTag = customTagForTrade(trade, account.id);
    const contractFields = { contractId: contract.id, contractName: contract.name };
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

    const { stopLossTicks, takeProfitTicks } = projectXBracketTicksForTrade(trade);
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

    try {
      const order = await placeProjectXOrder(targetRefresh.connection.token, request);
      return result(
        "placed",
        summarizeOrders(
          [
            {
              ...summaryBase,
              orderId: order.orderId,
              status: "placed"
            }
          ],
          contractFields
        )
      );
    } catch (error) {
      const rawMessage = readableProjectXError(error);
      if (isPositionBracketConflict(rawMessage) && positionBracketFallbackEnabled()) {
        const fallbackRequest = positionBracketFallbackRequest(request);
        try {
          const fallbackOrder = await placeProjectXOrder(targetRefresh.connection.token, fallbackRequest);
          return result(
            "placed",
            summarizeOrders(
              [
                {
                  ...summaryBase,
                  customTag: fallbackRequest.customTag ?? undefined,
                  error:
                    "Placed via ProjectX Position Brackets fallback. Exit protection is managed by the account-level Position Bracket settings; API TP/SL ticks were not attached.",
                  orderId: fallbackOrder.orderId,
                  status: "placed"
                }
              ],
              contractFields
            )
          );
        } catch (fallbackError) {
          const message = `${projectXOrderErrorMessage(rawMessage)} Fallback failed: ${readableProjectXError(fallbackError)}`;
          return result("failed", { error: message, orders: [{ ...summaryBase, error: message, status: "failed" }] });
        }
      }

      const message = projectXOrderErrorMessage(rawMessage);
      return result("failed", { error: message, orders: [{ ...summaryBase, error: message, status: "failed" }] });
    }
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

    const contractLookup = await projectXContractForTrade(accountTargets[0]!.token, trade);
    const contract = contractLookup.contract;
    if (!contract) return result("failed", { error: `No ProjectX contract found for ${contractLookup.searchTexts.join(", ")}.` });

    const baseSize = positiveNumber(trade.sizeMultiplier ?? 1, "Order size");
    const { stopLossTicks, takeProfitTicks } = projectXBracketTicksForTrade(trade);
    const entryType: ProjectXOrderType = trade.entryType === "limit" ? 1 : 2;
    const side: ProjectXOrderSide = trade.side === "long" ? 0 : 1;
    const contractFields = { contractId: contract.id, contractName: contract.name };
    const orders: AutoTradeOrderSummary[] = [
      ...failedRefreshOrders(
        connectionRefreshes,
        new Set(accountTargets.map((target) => target.account.id)),
        contractFields
      )
    ];

    for (const target of accountTargets) {
      const account = target.account;
      const size = projectXOrderSizeForAccount(trade, account, baseSize);
      const customTag = customTagForTrade(trade, account.id);
      if (size <= 0) {
        orders.push({
          accountConnectionId: target.accountConnectionId,
          accountGroupName: target.accountGroupName,
          accountId: account.id,
          accountBalance: account.balance,
          accountName: account.name,
          contractId: contract.id,
          contractName: contract.name,
          customTag,
          error:
            trade.orderLeg === "limit"
              ? "Limit leg skipped because the account-scaled total size leaves no remaining contract after the entry leg."
              : "Order skipped because the account-scaled size is below 1 contract.",
          size,
          status: "skipped"
        });
        continue;
      }
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
          accountConnectionId: target.accountConnectionId,
          accountGroupName: target.accountGroupName,
          accountId: account.id,
          accountBalance: account.balance,
          accountName: account.name,
          contractId: contract.id,
          contractName: contract.name,
          customTag,
          size,
          status: "dry_run"
        });
        continue;
      }

      try {
        const order = await placeProjectXOrder(target.token, request);
        orders.push({
          accountConnectionId: target.accountConnectionId,
          accountGroupName: target.accountGroupName,
          accountId: account.id,
          accountBalance: account.balance,
          accountName: account.name,
          contractId: contract.id,
          contractName: contract.name,
          customTag,
          orderId: order.orderId,
          size,
          status: "placed"
        });
      } catch (error) {
        const rawMessage = readableProjectXError(error);
        if (isPositionBracketConflict(rawMessage) && positionBracketFallbackEnabled()) {
          const fallbackRequest = positionBracketFallbackRequest(request);
          try {
            const fallbackOrder = await placeProjectXOrder(target.token, fallbackRequest);
            orders.push({
              accountConnectionId: target.accountConnectionId,
              accountGroupName: target.accountGroupName,
              accountId: account.id,
              accountBalance: account.balance,
              accountName: account.name,
              contractId: contract.id,
              contractName: contract.name,
              customTag: fallbackRequest.customTag ?? undefined,
              error:
                "Placed via ProjectX Position Brackets fallback. Exit protection is managed by the account-level Position Bracket settings; API TP/SL ticks were not attached.",
              orderId: fallbackOrder.orderId,
              size,
              status: "placed"
            });
            continue;
          } catch (fallbackError) {
            const message = `${projectXOrderErrorMessage(rawMessage)} Fallback failed: ${readableProjectXError(fallbackError)}`;
            orders.push({
              accountConnectionId: target.accountConnectionId,
              accountGroupName: target.accountGroupName,
              accountId: account.id,
              accountBalance: account.balance,
              accountName: account.name,
              contractId: contract.id,
              contractName: contract.name,
              customTag: fallbackRequest.customTag ?? undefined,
              error: message,
              size,
              status: "failed"
            });
            continue;
          }
        }
        const message = projectXOrderErrorMessage(rawMessage);
        orders.push({
          accountConnectionId: target.accountConnectionId,
          accountGroupName: target.accountGroupName,
          accountId: account.id,
          accountBalance: account.balance,
          accountName: account.name,
          contractId: contract.id,
          contractName: contract.name,
          customTag,
          error: message,
          size,
          status: "failed"
        });
      }
    }

    const placedOrders = orders.filter((order) => order.status === "placed");
    const actionableOrders = orders.filter((order) => order.status !== "skipped");
    if (!actionableOrders.length) return result("skipped", summarizeOrders(orders, contractFields));
    if (dryRunEnabled()) return result("dry_run", summarizeOrders(orders, contractFields));
    if (placedOrders.length) return result("placed", summarizeOrders(orders, contractFields));
    return result("failed", summarizeOrders(orders, contractFields));
  } catch (error) {
    return result("failed", { error: readableProjectXError(error) });
  }
}
