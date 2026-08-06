import { autoTradeMarketForSignal, autoTradeProviderById, type AutoTradeProviderId } from "@/lib/auto-trade-platforms";
import { buildAutoTradeTestTrade } from "@/lib/auto-trade-test";
import {
  cTraderBridgeConfigured,
  executeCTraderBridgeAutoTrade,
  executeMt5BridgeAutoTrade,
  executeRithmicBridgeAutoTrade,
  mt5BridgeConfigured,
  rithmicBridgeConfigured
} from "@/lib/bridge-auto-trader";
import { executeMatchTraderAutoTrade, matchTraderConfigured } from "@/lib/matchtrader-auto-trader";
import { executeMt5EaAutoTrade, mt5EaConfigured } from "@/lib/mt5-ea-auto-trader";
import { mt5CredentialBridgeConfigured } from "@/lib/mt5-credential-bridge";
import { getAutoTradeConnection } from "@/lib/auto-trade-connections";
import { getLatestStoredProjectXConnection } from "@/lib/projectx-connections";
import { executeProjectXAutoTrade, executeProjectXManagementTrade, executeProjectXTestTrade, type ProjectXAutoTradeResult } from "@/lib/projectx-auto-trader";
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

async function hasStoredProjectXConnection(): Promise<boolean> {
  return Boolean(await getLatestStoredProjectXConnection(process.env.PROJECTX_AUTO_TRADE_CONNECTION_ID?.trim()).catch(() => null));
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
    execute: executeMt5EaAutoTrade,
    isConfigured: () => mt5EaConfigured() || mt5CredentialBridgeConfigured(),
    providerId: "mt5_ea"
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

function connectorForProvider(providerId: AutoTradeProviderId): AutoTradeConnector | undefined {
  return AUTO_TRADE_CONNECTORS.find((connector) => connector.providerId === providerId);
}

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

function readableExecutionError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Auto-trade execution failed.";
}

export async function executeAutoTrade(trade: TradeAlert): Promise<AutoTradeExecutionResult> {
  const market = autoTradeMarketForSignal(trade.market);
  if (!market) {
    return result("skipped", { error: `No auto-trade market route exists for ${trade.market}.` });
  }
  const executionTrade: TradeAlert =
    market === "futures" && trade.entryType === "limit"
      ? {
          ...trade,
          entryType: "market"
        }
      : trade;

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
    try {
      const execution = await connector.execute(executionTrade);
      return {
        ...execution,
        providerId: connector.providerId,
        providerName,
        orders: annotateOrders(execution.orders, connector.providerId, providerName)
      };
    } catch (error) {
      return result("failed", {
        error: `${providerName} execution failed: ${readableExecutionError(error)}`,
        providerId: connector.providerId,
        providerName
      });
    }
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

  if (trade.market === "futures" && event.type === "edit_limit") {
    return result("skipped", {
      error: "Futures entries execute at market; there is no resting entry limit order to modify.",
      providerId,
      providerName
    });
  }

  if (!connector?.executeManagement) {
    return result("skipped", {
      error: `${providerName} does not support managed TP/SL modification in this app yet.`,
      providerId,
      providerName
    });
  }

  try {
    const execution = await connector.executeManagement(trade, event);
    return {
      ...execution,
      providerId: connector.providerId,
      providerName,
      orders: annotateOrders(execution.orders, connector.providerId, providerName)
    };
  } catch (error) {
    return result("failed", {
      error: `${providerName} management execution failed: ${readableExecutionError(error)}`,
      providerId,
      providerName
    });
  }
}

export async function executeAutoTradeTest(input: {
  accountId?: number;
  connectionId?: string;
  providerId: AutoTradeProviderId;
}): Promise<AutoTradeExecutionResult> {
  const provider = autoTradeProviderById(input.providerId);
  const providerName = provider?.label ?? input.providerId;

  if (input.providerId === "projectx") {
    if (!input.connectionId || typeof input.accountId !== "number") {
      return result("skipped", {
        error: "Choose a ProjectX account to test.",
        providerId: input.providerId,
        providerName
      });
    }

    const execution = await executeProjectXTestTrade({
      accountId: input.accountId,
      connectionId: input.connectionId
    });
    return {
      ...execution,
      providerId: input.providerId,
      providerName,
      orders: annotateOrders(execution.orders, input.providerId, providerName)
    };
  }

  const connector = connectorForProvider(input.providerId);
  const market = provider?.markets[0];
  if (!connector || !market) {
    return result("skipped", {
      error: `${providerName} cannot be tested by the auto-trade router yet.`,
      providerId: input.providerId,
      providerName
    });
  }

  const trade = await buildAutoTradeTestTrade(market, input.providerId);
  try {
    const execution = await connector.execute(trade);
    return {
      ...execution,
      providerId: connector.providerId,
      providerName,
      orders: annotateOrders(execution.orders, connector.providerId, providerName)
    };
  } catch (error) {
    return result("failed", {
      error: `${providerName} test execution failed: ${readableExecutionError(error)}`,
      providerId: connector.providerId,
      providerName
    });
  }
}
