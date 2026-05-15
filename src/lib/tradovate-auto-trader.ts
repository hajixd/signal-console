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

type TradovateTokenResponse = {
  accessToken?: string;
  errorText?: string;
};

type TradovatePlaceOrderResponse = {
  failureReason?: string | null;
  failureText?: string | null;
  orderId?: number | null;
};

type TradovateAccountRoute = {
  accountId: number;
  accountSpec: string;
};

const PROVIDER_NAME = "Tradovate / CQG";

function baseUrl(fields?: Record<string, string>): string {
  return (fieldText(fields, "apiBaseUrl", "TRADOVATE_API_BASE_URL") ?? "https://demo.tradovateapi.com/v1").replace(/\/+$/g, "");
}

function dryRunEnabled(): boolean {
  return envFlag("TRADOVATE_AUTO_TRADE_DRY_RUN", false);
}

export function tradovateConfigured(): boolean {
  return requiredEnv(["TRADOVATE_USERNAME", "TRADOVATE_PASSWORD"]).length === 0;
}

async function tradovateToken(fields?: Record<string, string>): Promise<string> {
  const response = await fetch(`${baseUrl(fields)}/auth/accesstokenrequest`, {
    body: JSON.stringify({
      appId: fieldText(fields, "appId", "TRADOVATE_APP_ID") ?? "TradingBot",
      appVersion: fieldText(fields, "appVersion", "TRADOVATE_APP_VERSION") ?? "1.0",
      cid: fieldText(fields, "cid", "TRADOVATE_CID"),
      name: fieldText(fields, "username", "TRADOVATE_USERNAME"),
      password: fieldText(fields, "password", "TRADOVATE_PASSWORD"),
      sec: fieldText(fields, "secret", "TRADOVATE_SECRET")
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function accountArray(value: unknown): Record<string, unknown>[] {
  const direct = Array.isArray(value) ? value : asRecord(value)?.accounts ?? asRecord(value)?.data ?? asRecord(value)?.result ?? [];
  return Array.isArray(direct) ? direct.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))) : [];
}

async function discoverTradovateAccount(token: string, fields?: Record<string, string>): Promise<TradovateAccountRoute | null> {
  const configuredId = Number(fieldText(fields, "accountId", "TRADOVATE_ACCOUNT_ID"));
  const configuredSpec = fieldText(fields, "accountSpec", "TRADOVATE_ACCOUNT_SPEC") ?? fieldText(fields, "username", "TRADOVATE_USERNAME");
  if (Number.isFinite(configuredId) && configuredSpec) return { accountId: configuredId, accountSpec: configuredSpec };

  const response = await fetch(`${baseUrl(fields)}/account/list`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
    method: "GET"
  });
  const parsed = await readJsonResponse<unknown>(response, "Tradovate account discovery failed.");
  const accounts = accountArray(parsed);
  const selected =
    accounts.find((account) => Number(stringValue(account.id)) === configuredId) ??
    accounts.find((account) => stringValue(account.name) === configuredSpec || stringValue(account.accountSpec) === configuredSpec) ??
    accounts[0];
  const accountId = Number(stringValue(selected?.id));
  if (!Number.isFinite(accountId)) return null;
  return {
    accountId,
    accountSpec: stringValue(selected?.name) ?? stringValue(selected?.accountSpec) ?? configuredSpec ?? fieldText(fields, "username", "TRADOVATE_USERNAME") ?? ""
  };
}

export async function executeTradovateAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  if (!envFlag("TRADOVATE_AUTO_TRADE_ENABLED", true)) {
    return result("disabled", { error: "TRADOVATE_AUTO_TRADE_ENABLED is disabled." });
  }

  const connection = await getAutoTradeConnection("tradovate");
  if (connection?.paused) return result("skipped", { error: "Tradovate connection is paused." });
  const fields = connection?.fields;
  const requiredMissing = [
    ["username", "TRADOVATE_USERNAME"],
    ["password", "TRADOVATE_PASSWORD"]
  ]
    .filter(([key, envName]) => !fieldText(fields, key, envName))
    .map(([key]) => key);
  if (requiredMissing.length) return result("skipped", { error: `Missing Tradovate credentials: ${requiredMissing.join(", ")}.` });

  try {
    const token = await tradovateToken(fields);
    const account = await discoverTradovateAccount(token, fields);
    if (!account) return result("skipped", { error: "Tradovate could not discover an account. Add Account ID in Advanced Settings." });
    const request = autoTradeRequest("TRADOVATE", trade, account.accountId, fields);

    if (dryRunEnabled()) {
      const order = dryRunOrder(request, PROVIDER_NAME);
      return result("dry_run", { accountId: order.accountId, contractId: request.symbol, contractName: request.symbol, orders: [order] });
    }

    if (!envFlag("TRADOVATE_ALLOW_UNBRACKETED_ORDERS", false)) {
      return result("skipped", {
        error: "Tradovate live execution is disabled until bracket/OCO stop-loss and take-profit support is configured. Set TRADOVATE_ALLOW_UNBRACKETED_ORDERS=1 to opt in explicitly."
      });
    }

    const response = await fetch(`${baseUrl(fields)}/order/placeorder`, {
      body: JSON.stringify({
        accountId: account.accountId,
        accountSpec: account.accountSpec,
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
      accountId: account.accountId,
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
    return result("failed", { error: message });
  }
}
