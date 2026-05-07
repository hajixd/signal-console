import {
  autoTradeRequest,
  dryRunOrder,
  envFlag,
  envText,
  fieldText,
  failedOrder,
  readJsonResponse,
  readableError,
  requiredEnv,
  result
} from "@/lib/auto-trade-utils";
import { getAutoTradeConnection } from "@/lib/auto-trade-connections";
import type { ProjectXAutoTradeResult } from "@/lib/projectx-auto-trader";
import type { TradeAlert } from "@/lib/types";

type TradeLockerTokenResponse = {
  accessToken?: string;
};

type TradeLockerOrderResponse = {
  orderId?: number;
  id?: number;
};

const PROVIDER_NAME = "TradeLocker";

function baseUrl(fields?: Record<string, string>): string {
  return (fieldText(fields, "apiBaseUrl", "TRADELOCKER_API_BASE_URL") ?? "https://demo.tradelocker.com/backend-api").replace(/\/+$/g, "");
}

function dryRunEnabled(): boolean {
  return envFlag("TRADELOCKER_AUTO_TRADE_DRY_RUN", false);
}

export function tradeLockerConfigured(): boolean {
  return requiredEnv(["TRADELOCKER_EMAIL", "TRADELOCKER_PASSWORD", "TRADELOCKER_SERVER", "TRADELOCKER_ACCOUNT_ID", "TRADELOCKER_ACC_NUM"]).length === 0;
}

async function tradeLockerToken(fields?: Record<string, string>): Promise<string> {
  const payload = {
    email: fieldText(fields, "email", "TRADELOCKER_EMAIL"),
    password: fieldText(fields, "password", "TRADELOCKER_PASSWORD"),
    server: fieldText(fields, "server", "TRADELOCKER_SERVER")
  };
  const response = await fetch(`${baseUrl(fields)}/auth/jwt/token`, {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  const parsed = await readJsonResponse<TradeLockerTokenResponse>(response, "TradeLocker login failed.");
  if (!parsed.accessToken) throw new Error("TradeLocker did not return an access token.");
  return parsed.accessToken;
}

export async function executeTradeLockerAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  if (!envFlag("TRADELOCKER_AUTO_TRADE_ENABLED", true)) {
    return result("disabled", { error: "TRADELOCKER_AUTO_TRADE_ENABLED is disabled." });
  }

  const connection = await getAutoTradeConnection("tradelocker");
  if (connection?.paused) return result("skipped", { error: "TradeLocker connection is paused." });
  const fields = connection?.fields;
  const requiredMissing = ["email", "password", "server", "accountId", "accNum"].filter((key) => !fields?.[key]);
  const envMissing = requiredEnv(["TRADELOCKER_EMAIL", "TRADELOCKER_PASSWORD", "TRADELOCKER_SERVER", "TRADELOCKER_ACCOUNT_ID", "TRADELOCKER_ACC_NUM"]);
  const accountIdValue = fieldText(fields, "accountId", "TRADELOCKER_ACCOUNT_ID");
  const request = autoTradeRequest("TRADELOCKER", trade, Number(accountIdValue) || accountIdValue, fields);
  if (!fields && envMissing.length) {
    return result("skipped", { error: `Missing TradeLocker env: ${envMissing.join(", ")}.` });
  }
  if (fields && requiredMissing.length) {
    return result("skipped", { error: `Missing TradeLocker connection fields: ${requiredMissing.join(", ")}.` });
  }

  const tradableInstrumentId =
    fields?.tradableInstrumentId ?? envText(`TRADELOCKER_${trade.symbol.toUpperCase()}_INSTRUMENT_ID`) ?? envText("TRADELOCKER_TRADABLE_INSTRUMENT_ID");
  const routeId = fields?.routeId ?? envText(`TRADELOCKER_${trade.symbol.toUpperCase()}_ROUTE_ID`) ?? envText("TRADELOCKER_ROUTE_ID") ?? "TRADE";
  if (!tradableInstrumentId) {
    return result("skipped", { error: `Missing TradeLocker instrument id for ${trade.symbol}. Set TRADELOCKER_${trade.symbol.toUpperCase()}_INSTRUMENT_ID or TRADELOCKER_TRADABLE_INSTRUMENT_ID.` });
  }

  if (dryRunEnabled()) {
    const order = dryRunOrder(request, PROVIDER_NAME);
    return result("dry_run", { accountId: order.accountId, contractId: request.symbol, contractName: request.symbol, orders: [order] });
  }

  try {
    const token = await tradeLockerToken(fields);
    const response = await fetch(`${baseUrl(fields)}/trade/accounts/${accountIdValue}/orders`, {
      body: JSON.stringify({
        price: request.entryType === "limit" ? request.entryPrice : 0,
        qty: request.size,
        routeId,
        side: request.action,
        stopLoss: request.stopLossPrice,
        takeProfit: request.takeProfitPrice,
        tradableInstrumentId: Number(tradableInstrumentId),
        type: request.entryType,
        validity: request.entryType === "market" ? "IOC" : "GTC"
      }),
      cache: "no-store",
      headers: {
        accNum: fieldText(fields, "accNum", "TRADELOCKER_ACC_NUM")!,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(fieldText(fields, "developerApiKey", "TRADELOCKER_DEVELOPER_API_KEY")
          ? { "developer-api-key": fieldText(fields, "developerApiKey", "TRADELOCKER_DEVELOPER_API_KEY")! }
          : {})
      },
      method: "POST"
    });
    const parsed = await readJsonResponse<TradeLockerOrderResponse>(response, "TradeLocker order placement failed.");
    const orderId = parsed.orderId ?? parsed.id;
    return result("placed", {
      accountId: typeof request.accountId === "number" ? request.accountId : undefined,
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
    const message = readableError(error, "TradeLocker order placement failed.");
    return result("failed", { error: message, orders: [failedOrder(request, message)] });
  }
}
