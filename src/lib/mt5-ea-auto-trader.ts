import { createHash } from "node:crypto";

import { tradeLevels } from "@/lib/auto-trade-utils";
import { getAutoTradeConnection } from "@/lib/auto-trade-connections";
import { mt5BridgeAccountId, mt5HeartbeatMismatch } from "@/lib/mt5-ea-account";
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
  error?: string
): AutoTradeOrderSummary {
  return {
    accountId: 0,
    accountName: bridgeAccount,
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
export async function executeMt5EaAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  if (!envFlag("MT5_EA_AUTO_TRADE_ENABLED", true)) {
    return result("disabled", { error: "MT5_EA_AUTO_TRADE_ENABLED is disabled." });
  }
  if (!mt5EaConfigured()) {
    return result("skipped", {
      error: "MT5 EA execution is not configured. Set EA_INGEST_TOKEN and TURSO_DATABASE_URL/TURSO_AUTH_TOKEN."
    });
  }

  const connection = await getAutoTradeConnection("mt5_ea").catch(() => null);
  if (connection?.paused) {
    return result("skipped", { error: "The connected MT5 account is paused. Enable it before sending trades." });
  }

  const connectionFields = connection?.fields ?? null;
  const account = mt5BridgeAccountId(connectionFields);
  const heartbeat = await getHeartbeat(account).catch(() => null);
  const heartbeatError = mt5HeartbeatMismatch(connectionFields, heartbeat);
  if (heartbeatError) {
    return result("skipped", {
      error: `${heartbeatError} In the EA settings, set Connection ID to ${account} and attach it to the saved account.`
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
      orders: [orderSummary(account, symbol, lots, customTag, "skipped", "non-positive lots")]
    });
  }

  // Dry-run: report what would be queued without enqueueing.
  if (envFlag("MT5_EA_AUTO_TRADE_DRY_RUN", false)) {
    return result("dry_run", {
      contractId: symbol,
      contractName: symbol,
      customTag,
      orders: [orderSummary(account, symbol, lots, customTag, "dry_run")]
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
      orders: [orderSummary(account, symbol, lots, customTag, "placed", deduped ? "deduped: existing queued order reused" : undefined)]
    });
  } catch (error) {
    return result("failed", {
      contractId: symbol,
      contractName: symbol,
      customTag,
      error: `MT5 EA enqueue failed: ${error instanceof Error ? error.message : String(error)}`,
      orders: [orderSummary(account, symbol, lots, customTag, "failed", error instanceof Error ? error.message : String(error))]
    });
  }
}
