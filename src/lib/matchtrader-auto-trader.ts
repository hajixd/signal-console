import {
  autoTradeRequest,
  dryRunOrder,
  envFlag,
  envText,
  failedOrder,
  readJsonResponse,
  readableError,
  requiredEnv,
  result
} from "@/lib/auto-trade-utils";
import type { ProjectXAutoTradeResult } from "@/lib/projectx-auto-trader";
import type { TradeAlert } from "@/lib/types";

type MatchTraderOrderResponse = {
  errorMessage?: string | null;
  nativeCode?: string | null;
  orderId?: number;
  positionId?: string;
  status?: "OK" | "PARTIAL_SUCCESS" | "REJECTED" | string;
};

const PROVIDER_NAME = "Match-Trader";

function platformUrl(): string {
  return envText("MATCHTRADER_PLATFORM_URL")!.replace(/\/+$/g, "");
}

function endpoint(path: string): string {
  return `${platformUrl()}/mtr-api/${envText("MATCHTRADER_SYSTEM_UUID")}/${path.replace(/^\/+/g, "")}`;
}

function dryRunEnabled(): boolean {
  return envFlag("MATCHTRADER_AUTO_TRADE_DRY_RUN", false);
}

export function matchTraderConfigured(): boolean {
  return requiredEnv(["MATCHTRADER_PLATFORM_URL", "MATCHTRADER_SYSTEM_UUID", "MATCHTRADER_TRADING_API_TOKEN"]).length === 0;
}

export async function executeMatchTraderAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  if (!envFlag("MATCHTRADER_AUTO_TRADE_ENABLED", true)) {
    return result("disabled", { error: "MATCHTRADER_AUTO_TRADE_ENABLED is disabled." });
  }

  const missing = requiredEnv(["MATCHTRADER_PLATFORM_URL", "MATCHTRADER_SYSTEM_UUID", "MATCHTRADER_TRADING_API_TOKEN"]);
  const request = autoTradeRequest("MATCHTRADER", trade, envText("MATCHTRADER_ACCOUNT_ID"));
  if (missing.length) return result("skipped", { error: `Missing Match-Trader env: ${missing.join(", ")}.` });

  if (dryRunEnabled()) {
    const order = dryRunOrder(request, PROVIDER_NAME);
    return result("dry_run", { accountId: order.accountId, contractId: request.symbol, contractName: request.symbol, orders: [order] });
  }

  try {
    const response = await fetch(endpoint(request.entryType === "limit" ? "/pending-order/create" : "/position/open"), {
      body: JSON.stringify(
        request.entryType === "limit"
          ? {
              instrument: request.symbol,
              isMobile: false,
              orderSide: request.action.toUpperCase(),
              price: request.entryPrice,
              slPrice: request.stopLossPrice,
              tpPrice: request.takeProfitPrice,
              type: "LIMIT",
              volume: request.size
            }
          : {
              instrument: request.symbol,
              isMobile: false,
              orderSide: request.action.toUpperCase(),
              slPrice: request.stopLossPrice,
              tpPrice: request.takeProfitPrice,
              volume: request.size
            }
      ),
      cache: "no-store",
      headers: {
        accept: "application/json",
        "auth-trading-api": envText("MATCHTRADER_TRADING_API_TOKEN")!,
        "content-type": "application/json",
        ...(envText("MATCHTRADER_CO_AUTH_COOKIE") ? { cookie: `co-auth=${envText("MATCHTRADER_CO_AUTH_COOKIE")}` } : {})
      },
      method: "POST"
    });
    const parsed = await readJsonResponse<MatchTraderOrderResponse>(response, "Match-Trader order placement failed.");
    if (parsed.status === "REJECTED" || parsed.errorMessage) throw new Error(parsed.errorMessage ?? "Match-Trader rejected the order.");
    const orderId = parsed.orderId;
    return result("placed", {
      contractId: request.symbol,
      contractName: request.symbol,
      orderId,
      orders: [
        {
          ...dryRunOrder(request, PROVIDER_NAME),
          orderId,
          status: "placed"
        }
      ]
    });
  } catch (error) {
    const message = readableError(error, "Match-Trader order placement failed.");
    return result("failed", { error: message, orders: [failedOrder(request, message)] });
  }
}
