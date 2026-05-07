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
import { executeProjectXAutoTrade, type ProjectXAutoTradeResult } from "@/lib/projectx-auto-trader";
import { executeTradeLockerAutoTrade, tradeLockerConfigured } from "@/lib/tradelocker-auto-trader";
import { executeTradovateAutoTrade, tradovateConfigured } from "@/lib/tradovate-auto-trader";
import type { AutoTradeOrderSummary, TradeAlert } from "@/lib/types";

export type AutoTradeExecutionResult = ProjectXAutoTradeResult & {
  providerId?: AutoTradeProviderId;
  providerName?: string;
};

type AutoTradeConnector = {
  execute: (trade: TradeAlert) => Promise<ProjectXAutoTradeResult>;
  isConfigured: () => boolean;
  providerId: AutoTradeProviderId;
};

const AUTO_TRADE_CONNECTORS: AutoTradeConnector[] = [
  {
    execute: executeProjectXAutoTrade,
    isConfigured: () => true,
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
  const market = autoTradeMarketForSignal(trade.market);
  if (!market) {
    return result("skipped", { error: `No auto-trade market route exists for ${trade.market}.` });
  }

  const preferredProviderId = (
    market === "futures" ? process.env.AUTO_TRADE_FUTURES_PROVIDER : process.env.AUTO_TRADE_FOREX_PROVIDER
  )?.trim() as AutoTradeProviderId | undefined;
  const marketConnectors = AUTO_TRADE_CONNECTORS.filter((connector) => autoTradeProviderById(connector.providerId)?.markets.includes(market));
  const preferredConnector = preferredProviderId ? marketConnectors.find((connector) => connector.providerId === preferredProviderId) : undefined;
  const connector = preferredConnector ?? marketConnectors.find((candidate) => candidate.isConfigured()) ?? marketConnectors[0];

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
