import { createHash } from "node:crypto";
import { assetForKey, assetForSymbol } from "@/lib/assets";
import { scaledAutoTradeSize } from "@/lib/auto-trade-utils";
import {
  getLatestStoredProjectXConnection,
  saveStoredProjectXConnection,
  type StoredProjectXConnection
} from "@/lib/projectx-connections";
import {
  placeProjectXOrder,
  readableProjectXError,
  searchProjectXAccounts,
  searchProjectXContracts,
  validateProjectXSession,
  type ProjectXAccount,
  type ProjectXContract,
  type ProjectXOrderSide,
  type ProjectXOrderType,
  type ProjectXPlaceOrderRequest
} from "@/lib/projectx";
import type { AutoTradeOrderSummary, TradeAlert } from "@/lib/types";

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
  "6C": "M6C",
  "6E": "M6E",
  "6J": "M6J",
  CL: "MCL",
  ES: "MES",
  GC: "MGC",
  HG: "MHG",
  NQ: "MNQ",
  RTY: "M2K",
  SI: "SIL",
  YM: "MYM"
};

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

function contractSearchTextForTrade(trade: TradeAlert): string {
  const symbol = trade.symbol.trim().toUpperCase();
  const overrides = parseContractOverrides();
  if (overrides[symbol]) return overrides[symbol];

  const asset = trade.assetKey ? assetForKey(trade.assetKey) : assetForSymbol(symbol);
  const sizeRoot = asset?.sizeLabel.match(/^\s*\d+(?:\.\d+)?\s+([A-Z][A-Z0-9]{1,4})\b/)?.[1];
  if (sizeRoot && !["CONTRACT", "FUTURE", "MICRO", "MINI"].includes(sizeRoot)) return sizeRoot;

  return CONTRACT_SEARCH_OVERRIDES[symbol] ?? symbol;
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

function tradeableAccounts(connection: StoredProjectXConnection): ProjectXAccount[] {
  const configuredAccountId = positiveIntegerEnv("PROJECTX_AUTO_TRADE_ACCOUNT_ID");
  const pausedAccountIds = new Set(connection.pausedAccountIds);
  const accounts = connection.accounts.filter((account) => account.canTrade && account.isVisible && !pausedAccountIds.has(account.id));
  if (configuredAccountId) {
    const configuredAccount = accounts.find((account) => account.id === configuredAccountId);
    return configuredAccount ? [configuredAccount] : [];
  }
  return accounts;
}

function summarizeOrders(
  orders: AutoTradeOrderSummary[],
  fields: Pick<ProjectXAutoTradeResult, "contractId" | "contractName"> = {}
): Omit<ProjectXAutoTradeResult, "checkedAt" | "status"> {
  const first = orders[0];
  const failed = orders.filter((order) => order.status === "failed");
  const skipped = orders.filter((order) => order.status === "skipped");
  return {
    accountId: orders.length === 1 ? first?.accountId : undefined,
    accountName: orders.length > 1 ? `${orders.length} accounts` : first?.accountName,
    contractId: first?.contractId ?? fields.contractId,
    contractName: first?.contractName ?? fields.contractName,
    customTag: orders.length === 1 ? first?.customTag : undefined,
    error: failed.length
      ? `${failed.length} account(s) failed: ${failed.map((order) => order.accountName ?? order.accountId).join(", ")}`
      : skipped.length
        ? `${skipped.length} account(s) skipped: ${skipped.map((order) => order.accountName ?? order.accountId).join(", ")}`
        : undefined,
    orderId: orders.length === 1 ? first?.orderId : undefined,
    orders
  };
}

async function refreshedConnection(): Promise<StoredProjectXConnection | null> {
  const connection = await getLatestStoredProjectXConnection(process.env.PROJECTX_AUTO_TRADE_CONNECTION_ID?.trim());
  if (!connection) return null;

  const refreshedToken = await validateProjectXSession(connection.token);
  const activeToken = refreshedToken ?? connection.token;
  const accounts = await searchProjectXAccounts(activeToken, true);
  return saveStoredProjectXConnection({
    accessCodeHash: connection.accessCodeHash,
    accounts,
    autoTradePaused: connection.autoTradePaused,
    connectedAt: connection.connectedAt,
    id: connection.id,
    pausedAccountIds: connection.pausedAccountIds,
    token: activeToken,
    userName: connection.userName
  });
}

export async function executeProjectXAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  if (!projectXAutoTradingEnabled()) {
    return result("disabled", { error: "PROJECTX_AUTO_TRADE_ENABLED is disabled." });
  }

  if (trade.market !== "futures") {
    return result("skipped", { error: "ProjectX auto trading is only enabled for futures signals." });
  }

  try {
    const connection = await refreshedConnection();
    if (!connection) return result("skipped", { error: "No TopstepX ProjectX connection is available." });

    const accounts = tradeableAccounts(connection);
    if (!accounts.length) {
      return result("skipped", {
        error: positiveIntegerEnv("PROJECTX_AUTO_TRADE_ACCOUNT_ID")
          ? "Configured PROJECTX_AUTO_TRADE_ACCOUNT_ID was not found or is paused."
          : "No connected unpaused ProjectX accounts are available."
      });
    }

    const searchText = contractSearchTextForTrade(trade);
    const contract = bestContract(await searchProjectXContracts(connection.token, searchText, projectXContractLiveFlag()), searchText);
    if (!contract) return result("failed", { error: `No ProjectX contract found for ${searchText}.` });

    const baseSize =
      trade.orderLeg === "entry" || trade.orderLeg === "limit"
        ? positiveNumber(trade.sizeMultiplier ?? 1, "Order size")
        : wholeNumber(trade.sizeMultiplier ?? 1, "Order size");
    const stopLossTicks = wholeNumber(Math.abs(trade.slUnits), "Stop-loss ticks");
    const takeProfitTicks = wholeNumber(Math.abs(trade.tpUnits), "Take-profit ticks");
    const entryType: ProjectXOrderType = trade.entryType === "limit" ? 1 : 2;
    const side: ProjectXOrderSide = trade.side === "long" ? 0 : 1;
    const orders: AutoTradeOrderSummary[] = [];

    for (const account of accounts) {
      const size = projectXOrderSizeForAccount(trade, account, baseSize);
      const customTag = customTagForTrade(trade, account.id);
      if (size <= 0) {
        orders.push({
          accountId: account.id,
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
          accountId: account.id,
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
        const order = await placeProjectXOrder(connection.token, request);
        orders.push({
          accountId: account.id,
          accountName: account.name,
          contractId: contract.id,
          contractName: contract.name,
          customTag,
          orderId: order.orderId,
          size,
          status: "placed"
        });
      } catch (error) {
        orders.push({
          accountId: account.id,
          accountName: account.name,
          contractId: contract.id,
          contractName: contract.name,
          customTag,
          error: readableProjectXError(error),
          size,
          status: "failed"
        });
      }
    }

    const placedOrders = orders.filter((order) => order.status === "placed");
    const actionableOrders = orders.filter((order) => order.status !== "skipped");
    const contractFields = { contractId: contract.id, contractName: contract.name };
    if (!actionableOrders.length) return result("skipped", summarizeOrders(orders, contractFields));
    if (dryRunEnabled()) return result("dry_run", summarizeOrders(orders, contractFields));
    if (placedOrders.length) return result("placed", summarizeOrders(orders, contractFields));
    return result("failed", summarizeOrders(orders, contractFields));
  } catch (error) {
    return result("failed", { error: readableProjectXError(error) });
  }
}
