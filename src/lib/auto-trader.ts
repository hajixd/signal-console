import { autoTradeMarketForSignal, autoTradeProviderById, type AutoTradeProviderId } from "@/lib/auto-trade-platforms";
import {
  cTraderBridgeConfigured,
  executeCTraderBridgeAutoTrade,
  executeMt5BridgeAutoTrade,
  executeRithmicBridgeAutoTrade,
  mt5BridgeConfigured,
  rithmicBridgeConfigured
} from "@/lib/bridge-auto-trader";
import { executeMatchTraderAutoTrade, matchTraderConfigured } from "@/lib/matchtrader-auto-trader";
import { getAutoTradeConnection } from "@/lib/auto-trade-connections";
import { getLatestStoredProjectXConnection } from "@/lib/projectx-connections";
import { executeProjectXAutoTrade, executeProjectXManagementTrade, type ProjectXAutoTradeResult } from "@/lib/projectx-auto-trader";
import { executeTradeLockerAutoTrade, tradeLockerConfigured } from "@/lib/tradelocker-auto-trader";
import { executeTradovateAutoTrade, tradovateConfigured } from "@/lib/tradovate-auto-trader";
import type { AutoTradeOrderSummary, TradeAlert, TradeManagementEvent } from "@/lib/types";

export type AutoTradeExecutionResult = ProjectXAutoTradeResult & {
  providerId?: AutoTradeProviderId;
  providerName?: string;
};

type AutoTradeConnector = {
  execute: (trade: TradeAlert) => Promise<ProjectXAutoTradeResult>;
  executeManagement?: (trade: TradeAlert, event: TradeManagementEvent) => Promise<ProjectXAutoTradeResult>;
  hasConnection?: () => Promise<boolean>;
  isConfigured: () => boolean;
  providerId: AutoTradeProviderId;
};

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

async function hasStoredProjectXConnection(): Promise<boolean> {
  return Boolean(await getLatestStoredProjectXConnection(process.env.PROJECTX_AUTO_TRADE_CONNECTION_ID?.trim()).catch(() => null));
}

function unsafeLimitOrderGuard(trade: TradeAlert): AutoTradeExecutionResult | null {
  if (trade.entryType !== "limit" || envFlag("AUTO_TRADE_ALLOW_LIVE_LIMIT_ORDERS", true)) return null;
  return result("skipped", {
    error: "Live limit-order execution is disabled by AUTO_TRADE_ALLOW_LIVE_LIMIT_ORDERS=0."
  });
}

const AUTO_TRADE_CONNECTORS: AutoTradeConnector[] = [
  {
    execute: executeProjectXAutoTrade,
    executeManagement: executeProjectXManagementTrade,
    hasConnection: hasStoredProjectXConnection,
    isConfigured: () => Boolean(process.env.PROJECTX_AUTO_TRADE_CONNECTION_ID?.trim()),
    providerId: "projectx"
  },
  {
    execute: executeTradovateAutoTrade,
    isConfigured: tradovateConfigured,
    providerId: "tradovate"
  },
  {
    execute: executeRithmicBridgeAutoTrade,
    isConfigured: rithmicBridgeConfigured,
    providerId: "rithmic"
  },
  {
    execute: executeTradeLockerAutoTrade,
    isConfigured: tradeLockerConfigured,
    providerId: "tradelocker"
  },
  {
    execute: executeMt5BridgeAutoTrade,
    isConfigured: mt5BridgeConfigured,
    providerId: "mt5_bridge"
  },
  {
    execute: executeCTraderBridgeAutoTrade,
    isConfigured: cTraderBridgeConfigured,
    providerId: "ctrader"
  },
  {
    execute: executeMatchTraderAutoTrade,
    isConfigured: matchTraderConfigured,
    providerId: "matchtrader"
  }
];

function annotateOrders(
  orders: AutoTradeOrderSummary[] | undefined,
  providerId: AutoTradeProviderId,
  providerName: string
): AutoTradeOrderSummary[] | undefined {
  return orders?.map((order) => ({
    providerId,
    providerName,
    ...order
  }));
}

function result(
  status: AutoTradeExecutionResult["status"],
  fields: Omit<AutoTradeExecutionResult, "checkedAt" | "status"> = {}
): AutoTradeExecutionResult {
  return {
    checkedAt: new Date().toISOString(),
    status,
    ...fields
  };
}

export async function executeAutoTrade(trade: TradeAlert): Promise<AutoTradeExecutionResult> {
  const limitGuard = unsafeLimitOrderGuard(trade);
  if (limitGuard) return limitGuard;

  const market = autoTradeMarketForSignal(trade.market);
  if (!market) {
    return result("skipped", { error: `No auto-trade market route exists for ${trade.market}.` });
  }

  const preferredProviderId = (
    market === "futures" ? process.env.AUTO_TRADE_FUTURES_PROVIDER : process.env.AUTO_TRADE_FOREX_PROVIDER
  )?.trim() as AutoTradeProviderId | undefined;
  const marketConnectors = AUTO_TRADE_CONNECTORS.filter((connector) => autoTradeProviderById(connector.providerId)?.markets.includes(market));
  const preferredConnector = preferredProviderId ? marketConnectors.find((connector) => connector.providerId === preferredProviderId) : undefined;
  let connector = preferredConnector;
  if (!connector) {
    for (const candidate of marketConnectors) {
      if (candidate.hasConnection ? await candidate.hasConnection() : await getAutoTradeConnection(candidate.providerId)) {
        connector = candidate;
        break;
      }
    }
  }
  connector ??= marketConnectors.find((candidate) => candidate.isConfigured());
  connector ??= marketConnectors[0];

  if (connector) {
    const provider = autoTradeProviderById(connector.providerId);
    const providerName = provider?.label ?? connector.providerId;
    const execution = await connector.execute(trade);
    return {
      ...execution,
      providerId: connector.providerId,
      providerName,
      orders: annotateOrders(execution.orders, connector.providerId, providerName)
    };
  }

  return result("skipped", {
    error: `No live ${market} connector is connected yet. Add a live connector adapter, then this router will execute those signals.`,
    providerName: `${market === "futures" ? "Futures" : "Forex"} execution router`
  });
}

export async function executeAutoTradeManagement(trade: TradeAlert, event: TradeManagementEvent): Promise<AutoTradeExecutionResult> {
  const providerId = (trade.autoTradeProviderId ?? process.env.AUTO_TRADE_FUTURES_PROVIDER ?? "projectx").trim() as AutoTradeProviderId;
  const connector = AUTO_TRADE_CONNECTORS.find((candidate) => candidate.providerId === providerId) ?? AUTO_TRADE_CONNECTORS[0];
  const provider = connector ? autoTradeProviderById(connector.providerId) : undefined;
  const providerName = provider?.label ?? providerId;

  if (!connector?.executeManagement) {
    return result("skipped", {
      error: `${providerName} does not support managed TP/SL modification in this app yet.`,
      providerId,
      providerName
    });
  }

  const execution = await connector.executeManagement(trade, event);
  return {
    ...execution,
    providerId: connector.providerId,
    providerName,
    orders: annotateOrders(execution.orders, connector.providerId, providerName)
  };
}
