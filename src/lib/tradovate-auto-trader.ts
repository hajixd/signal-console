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

type TradovateTokenResponse = {
  accessToken?: string;
  errorText?: string;
};

type TradovatePlaceOrderResponse = {
  failureReason?: string | null;
  failureText?: string | null;
  orderId?: number | null;
};

const PROVIDER_NAME = "Tradovate / CQG";

function baseUrl(): string {
  return (envText("TRADOVATE_API_BASE_URL") ?? "https://demo.tradovateapi.com/v1").replace(/\/+$/g, "");
}

function dryRunEnabled(): boolean {
  return envFlag("TRADOVATE_AUTO_TRADE_DRY_RUN", false);
}

export function tradovateConfigured(): boolean {
  return requiredEnv(["TRADOVATE_USERNAME", "TRADOVATE_PASSWORD", "TRADOVATE_ACCOUNT_ID"]).length === 0;
}

async function tradovateToken(): Promise<string> {
  const response = await fetch(`${baseUrl()}/auth/accesstokenrequest`, {
    body: JSON.stringify({
      appId: envText("TRADOVATE_APP_ID") ?? "TradingBot",
      appVersion: envText("TRADOVATE_APP_VERSION") ?? "1.0",
      cid: envText("TRADOVATE_CID"),
      name: envText("TRADOVATE_USERNAME"),
      password: envText("TRADOVATE_PASSWORD"),
      sec: envText("TRADOVATE_SECRET")
    }),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  const parsed = await readJsonResponse<TradovateTokenResponse>(response, "Tradovate login failed.");
  if (parsed.errorText) throw new Error(parsed.errorText);
  if (!parsed.accessToken) throw new Error("Tradovate did not return an access token.");
  return parsed.accessToken;
}

export async function executeTradovateAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  if (!envFlag("TRADOVATE_AUTO_TRADE_ENABLED", true)) {
    return result("disabled", { error: "TRADOVATE_AUTO_TRADE_ENABLED is disabled." });
  }

  const missing = requiredEnv(["TRADOVATE_USERNAME", "TRADOVATE_PASSWORD", "TRADOVATE_ACCOUNT_ID"]);
  const accountId = Number(envText("TRADOVATE_ACCOUNT_ID"));
  const request = autoTradeRequest("TRADOVATE", trade, Number.isFinite(accountId) ? accountId : envText("TRADOVATE_ACCOUNT_ID"));
  if (missing.length) return result("skipped", { error: `Missing Tradovate env: ${missing.join(", ")}.` });

  if (dryRunEnabled()) {
    const order = dryRunOrder(request, PROVIDER_NAME);
    return result("dry_run", { accountId: order.accountId, contractId: request.symbol, contractName: request.symbol, orders: [order] });
  }

  try {
    const token = await tradovateToken();
    const response = await fetch(`${baseUrl()}/order/placeorder`, {
      body: JSON.stringify({
        accountId,
        accountSpec: envText("TRADOVATE_ACCOUNT_SPEC") ?? envText("TRADOVATE_USERNAME"),
        action: request.action === "buy" ? "Buy" : "Sell",
        clOrdId: request.customTag,
        isAutomated: true,
        orderQty: Math.max(1, Math.round(request.size)),
        orderType: request.entryType === "limit" ? "Limit" : "Market",
        price: request.entryType === "limit" ? request.entryPrice : undefined,
        symbol: request.symbol,
        text: request.customTag,
        timeInForce: request.entryType === "limit" ? "GTC" : "Day"
      }),
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      method: "POST"
    });
    const parsed = await readJsonResponse<TradovatePlaceOrderResponse>(response, "Tradovate order placement failed.");
    if (parsed.failureReason && parsed.failureReason !== "Success") {
      throw new Error(parsed.failureText ?? parsed.failureReason);
    }
    const orderId = parsed.orderId ?? undefined;
    return result("placed", {
      accountId,
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
    const message = readableError(error, "Tradovate order placement failed.");
    return result("failed", { error: message, orders: [failedOrder(request, message)] });
  }
}
