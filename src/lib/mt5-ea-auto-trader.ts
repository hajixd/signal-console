import { createHash } from "node:crypto";

import { tradeLevels } from "@/lib/auto-trade-utils";
import {
  getAutoTradeConnection,
  listAutoTradeConnectionsForProvider,
  type AutoTradeConnection
} from "@/lib/auto-trade-connections";
import { executeMt5CredentialAutoTrade } from "@/lib/bridge-auto-trader";
import { mt5BridgeAccountId, mt5HeartbeatMismatch } from "@/lib/mt5-ea-account";
import { storedMt5ConnectionMode } from "@/lib/mt5-connection-mode";
import { mt5CredentialBridgeConfigured } from "@/lib/mt5-credential-bridge";
import { enqueueMt5Order, mt5EaConfigured, type Mt5OrderSide } from "@/lib/mt5-ea-queue";
import { resolveMt5Lots } from "@/lib/mt5-ea-sizing";
import { getHeartbeat } from "@/lib/mt5-ea-state";
import type { ProjectXAutoTradeResult, ProjectXAutoTradeStatus } from "@/lib/projectx-auto-trader";
import type { AutoTradeOrderSummary, TradeAlert } from "@/lib/types";

export { mt5EaConfigured };

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function parseSymbolMap(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  const out: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const [key, value] = entry.split(":");
    const from = key?.trim().toUpperCase();
    const to = value?.trim();
    if (from && to) out[from] = to;
  }
  return out;
}

function mappedSymbol(trade: TradeAlert, connectionMap?: string): string {
  const symbol = trade.symbol.trim().toUpperCase();
  return parseSymbolMap(connectionMap || process.env.MT5_EA_SYMBOL_MAP)[symbol] ?? symbol;
}

function result(
  status: ProjectXAutoTradeStatus,
  fields: Omit<ProjectXAutoTradeResult, "checkedAt" | "status"> = {}
): ProjectXAutoTradeResult {
  return { checkedAt: new Date().toISOString(), status, ...fields };
}

function orderSummary(
  bridgeAccount: string,
  symbol: string,
  lots: number,
  customTag: string,
  status: AutoTradeOrderSummary["status"],
  error?: string,
  accountName?: string
): AutoTradeOrderSummary {
  const numericAccountId = Number(bridgeAccount);
  return {
    accountId: Number.isFinite(numericAccountId) ? numericAccountId : 0,
    accountName: accountName ?? bridgeAccount,
    contractId: symbol,
    contractName: symbol,
    customTag,
    size: lots,
    sizeUnit: "lots",
    status,
    ...(error ? { error } : {})
  };
}

/**
 * Forex execution via the MT5 EA pull queue. Instead of pushing to a Windows
 * bridge, this enqueues an order that the in-terminal EA polls and executes.
 */
async function executeMt5TradeForConnection(
  trade: TradeAlert,
  connection: AutoTradeConnection | null
): Promise<ProjectXAutoTradeResult> {
  if (connection?.paused) {
    return result("skipped", { error: "The connected MT5 account is paused. Enable it before sending trades." });
  }

  if (connection && storedMt5ConnectionMode(connection.fields) === "credential_bridge") {
    if (!mt5CredentialBridgeConfigured()) {
      return result("skipped", { error: "The secure MT5 credential service is not configured." });
    }
    return executeMt5CredentialAutoTrade(trade, connection);
  }

  if (!mt5EaConfigured()) {
    return result("skipped", {
      error: "MT5 EA execution is not configured. Set EA_INGEST_TOKEN and TURSO_DATABASE_URL/TURSO_AUTH_TOKEN."
    });
  }

  const connectionFields = connection?.fields ?? null;
  const account = mt5BridgeAccountId(connectionFields);
  const accountName = connection?.accountName ?? connection?.accountId ?? account;
  const heartbeat = await getHeartbeat(account).catch(() => null);
  const heartbeatError = mt5HeartbeatMismatch(connectionFields, heartbeat);
  if (heartbeatError) {
    return result("skipped", {
      error: `${heartbeatError} Start the Korra MT5 EA on login ${account}; it uses the signed-in MT5 login as the Connection ID automatically.`
    });
  }

  const symbol = mappedSymbol(trade, connectionFields?.symbolMap);
  const side: Mt5OrderSide = trade.side === "long" ? "buy" : "sell";
  const entryType = trade.entryType === "limit" ? "limit" : "market";
  const { stopLossPrice, takeProfitPrice } = tradeLevels(trade);
  const customTag = `tb_${createHash("sha256").update(`mt5_ea:${trade.id}:${account}`).digest("hex").slice(0, 24)}`;

  let lots: number;
  let riskUsd: number;
  try {
    const savedBalance = Number(connectionFields?.accountSize);
    const sizing = await resolveMt5Lots(trade, account, {
      configuredBalance: Number.isFinite(savedBalance) && savedBalance > 0 ? savedBalance : undefined
    });
    lots = sizing.lots;
    riskUsd = sizing.riskUsd;
  } catch (error) {
    return result("failed", {
      contractId: symbol,
      contractName: symbol,
      error: `MT5 EA sizing failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }

  if (!(lots > 0)) {
    return result("skipped", {
      contractId: symbol,
      contractName: symbol,
      error: `Computed lot size was not positive (${lots}).`,
      orders: [orderSummary(account, symbol, lots, customTag, "skipped", "non-positive lots", accountName)]
    });
  }

  // Dry-run: report what would be queued without enqueueing.
  if (envFlag("MT5_EA_AUTO_TRADE_DRY_RUN", false)) {
    return result("dry_run", {
      contractId: symbol,
      contractName: symbol,
      customTag,
      orders: [orderSummary(account, symbol, lots, customTag, "dry_run", undefined, accountName)]
    });
  }

  try {
    const { id, deduped } = await enqueueMt5Order({
      bridgeAccountId: account,
      symbol,
      side,
      volume: lots,
      entryType,
      entryPrice: entryType === "limit" ? (trade.limitOrderPrice ?? trade.entryPrice) : undefined,
      sl: stopLossPrice,
      tp: takeProfitPrice,
      sourceAlertId: trade.id,
      customTag,
      riskUsd,
      comment: customTag.slice(0, 16)
    });
    return result("placed", {
      contractId: symbol,
      contractName: symbol,
      customTag,
      orders: [orderSummary(account, symbol, lots, customTag, "placed", deduped ? "deduped: existing queued order reused" : undefined, accountName)]
    });
  } catch (error) {
    return result("failed", {
      contractId: symbol,
      contractName: symbol,
      customTag,
      error: `MT5 EA enqueue failed: ${error instanceof Error ? error.message : String(error)}`,
      orders: [orderSummary(account, symbol, lots, customTag, "failed", error instanceof Error ? error.message : String(error), accountName)]
    });
  }
}

export function aggregateMt5Results(
  targets: Array<{ connection: AutoTradeConnection | null; execution: ProjectXAutoTradeResult }>
): ProjectXAutoTradeResult {
  if (targets.length === 1) return targets[0].execution;

  const executions = targets.map((target) => target.execution);
  const status = executions.some((execution) => execution.status === "placed")
    ? "placed"
    : executions.some((execution) => execution.status === "dry_run")
      ? "dry_run"
      : executions.some((execution) => execution.status === "failed")
        ? "failed"
        : executions.some((execution) => execution.status === "skipped")
          ? "skipped"
          : "disabled";
  const errors = targets
    .filter((target) => target.execution.status !== "placed" && target.execution.error)
    .map((target) => {
      const label = target.connection?.accountName ?? target.connection?.accountId ?? target.connection?.id ?? "MT5";
      return `${label}: ${target.execution.error}`;
    });
  const firstWithContract = executions.find((execution) => execution.contractId || execution.contractName);

  return result(status, {
    contractId: firstWithContract?.contractId,
    contractName: firstWithContract?.contractName,
    error: errors.length ? errors.join(" ") : undefined,
    orders: executions.flatMap((execution) => execution.orders ?? [])
  });
}

export async function executeMt5EaAutoTrade(
  trade: TradeAlert,
  options: { connectionId?: string } = {}
): Promise<ProjectXAutoTradeResult> {
  if (!envFlag("MT5_EA_AUTO_TRADE_ENABLED", true)) {
    return result("disabled", { error: "MT5_EA_AUTO_TRADE_ENABLED is disabled." });
  }

  const connections = options.connectionId
    ? [await getAutoTradeConnection("mt5_ea", options.connectionId).catch(() => null)].filter(
        (connection): connection is AutoTradeConnection => connection !== null
      )
    : await listAutoTradeConnectionsForProvider("mt5_ea").catch(() => [] as AutoTradeConnection[]);
  if (options.connectionId && !connections.length) {
    return result("skipped", { error: "This MT5 account connection no longer exists." });
  }

  const executionTargets: Array<AutoTradeConnection | null> = connections.length ? connections : [null];
  const executions: Array<{ connection: AutoTradeConnection | null; execution: ProjectXAutoTradeResult }> = [];
  for (const connection of executionTargets) {
    executions.push({ connection, execution: await executeMt5TradeForConnection(trade, connection) });
  }
  return aggregateMt5Results(executions);
}
