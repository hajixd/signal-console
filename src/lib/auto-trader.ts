import { autoTradeMarketForSignal, autoTradeProviderById, type AutoTradeProviderId } from "@/lib/auto-trade-platforms";
import { executeProjectXAutoTrade, type ProjectXAutoTradeResult } from "@/lib/projectx-auto-trader";
import type { AutoTradeOrderSummary, TradeAlert } from "@/lib/types";

export type AutoTradeExecutionResult = ProjectXAutoTradeResult & {
  providerId?: AutoTradeProviderId;
  providerName?: string;
};

type AutoTradeConnector = {
  execute: (trade: TradeAlert) => Promise<ProjectXAutoTradeResult>;
  providerId: AutoTradeProviderId;
};

const AUTO_TRADE_CONNECTORS: AutoTradeConnector[] = [
  {
    execute: executeProjectXAutoTrade,
    providerId: "projectx"
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

  for (const connector of AUTO_TRADE_CONNECTORS) {
    const provider = autoTradeProviderById(connector.providerId);
    if (!provider?.markets.includes(market)) continue;

    const providerName = provider.label;
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
