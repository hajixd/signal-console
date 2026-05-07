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

type TradeLockerAccountRoute = {
  accountId?: number | string;
  accNum?: string;
};

type TradeLockerInstrumentRoute = {
  routeId?: string;
  tradableInstrumentId?: number | string;
};

const PROVIDER_NAME = "TradeLocker";

function baseUrl(fields?: Record<string, string>): string {
  return (fieldText(fields, "apiBaseUrl", "TRADELOCKER_API_BASE_URL") ?? "https://demo.tradelocker.com/backend-api").replace(/\/+$/g, "");
}

function dryRunEnabled(): boolean {
  return envFlag("TRADELOCKER_AUTO_TRADE_DRY_RUN", false);
}

export function tradeLockerConfigured(): boolean {
  return requiredEnv(["TRADELOCKER_EMAIL", "TRADELOCKER_PASSWORD", "TRADELOCKER_SERVER"]).length === 0;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function nestedArray(value: unknown): Record<string, unknown>[] {
  const direct = Array.isArray(value) ? value : asRecord(value)?.accounts ?? asRecord(value)?.data ?? asRecord(value)?.result ?? [];
  const items = Array.isArray(direct) ? direct : [];
  return items.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const nested = record.accounts ?? record.tradeAccounts ?? record.tradingAccounts;
    return [record, ...(Array.isArray(nested) ? nested.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry))) : [])];
  });
}

function fieldFrom(record: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = stringValue(record[name]);
    if (value) return value;
  }
  return undefined;
}

async function discoverTradeLockerAccount(token: string, fields?: Record<string, string>): Promise<TradeLockerAccountRoute | null> {
  const accountId = fieldText(fields, "accountId", "TRADELOCKER_ACCOUNT_ID");
  const accNum = fieldText(fields, "accNum", "TRADELOCKER_ACC_NUM");
  if (accountId && accNum) return { accountId, accNum };

  const response = await fetch(`${baseUrl(fields)}/auth/jwt/all-accounts`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}` },
    method: "GET"
  });
  const parsed = await readJsonResponse<unknown>(response, "TradeLocker account discovery failed.");
  const accounts = nestedArray(parsed);
  const selected =
    accounts.find((account) => accountId && fieldFrom(account, ["id", "accountId", "account_id"]) === accountId) ??
    accounts.find((account) => accNum && fieldFrom(account, ["accNum", "accountNumber", "account_number"]) === accNum) ??
    accounts[0];
  if (!selected) return accountId || accNum ? { accountId, accNum } : null;
  return {
    accountId: accountId ?? fieldFrom(selected, ["id", "accountId", "account_id"]),
    accNum: accNum ?? fieldFrom(selected, ["accNum", "accountNumber", "account_number"])
  };
}

async function discoverTradeLockerInstrument(
  token: string,
  route: TradeLockerAccountRoute,
  symbol: string,
  fields?: Record<string, string>
): Promise<TradeLockerInstrumentRoute | null> {
  const configuredInstrumentId =
    fields?.tradableInstrumentId ?? envText(`TRADELOCKER_${symbol.toUpperCase()}_INSTRUMENT_ID`) ?? envText("TRADELOCKER_TRADABLE_INSTRUMENT_ID");
  const configuredRouteId = fields?.routeId ?? envText(`TRADELOCKER_${symbol.toUpperCase()}_ROUTE_ID`) ?? envText("TRADELOCKER_ROUTE_ID") ?? "TRADE";
  if (configuredInstrumentId) return { routeId: configuredRouteId, tradableInstrumentId: configuredInstrumentId };
  if (!route.accountId || !route.accNum) return null;

  const urls = [`${baseUrl(fields)}/trade/accounts/${route.accountId}/instruments`, `${baseUrl(fields)}/trade/instruments`];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          accNum: route.accNum,
          authorization: `Bearer ${token}`
        },
        method: "GET"
      });
      const parsed = await readJsonResponse<unknown>(response, "TradeLocker instrument discovery failed.");
      const instruments = nestedArray(parsed);
      const normalizedSymbol = symbol.trim().toUpperCase();
      const selected = instruments.find((instrument) =>
        [fieldFrom(instrument, ["symbol", "name", "tradableInstrument", "tradableInstrumentSymbol"]), fieldFrom(instrument, ["description"])]
          .filter(Boolean)
          .some((value) => value!.trim().toUpperCase() === normalizedSymbol)
      );
      if (!selected) continue;
      const routes = Array.isArray(selected.routes) ? selected.routes.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry))) : [];
      const selectedRoute = routes.find((item) => fieldFrom(item, ["id", "routeId", "name"]) === configuredRouteId) ?? routes[0];
      return {
        routeId: fieldFrom(selectedRoute ?? {}, ["id", "routeId", "name"]) ?? configuredRouteId,
        tradableInstrumentId: fieldFrom(selected, ["tradableInstrumentId", "instrumentId", "id"])
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function executeTradeLockerAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  if (!envFlag("TRADELOCKER_AUTO_TRADE_ENABLED", true)) {
    return result("disabled", { error: "TRADELOCKER_AUTO_TRADE_ENABLED is disabled." });
  }

  const connection = await getAutoTradeConnection("tradelocker");
  if (connection?.paused) return result("skipped", { error: "TradeLocker connection is paused." });
  const fields = connection?.fields;
  const requiredMissing = [
    ["email", "TRADELOCKER_EMAIL"],
    ["password", "TRADELOCKER_PASSWORD"],
    ["server", "TRADELOCKER_SERVER"]
  ]
    .filter(([key, envName]) => !fieldText(fields, key, envName))
    .map(([key]) => key);
  if (requiredMissing.length) return result("skipped", { error: `Missing TradeLocker credentials: ${requiredMissing.join(", ")}.` });

  try {
    const token = await tradeLockerToken(fields);
    const route = await discoverTradeLockerAccount(token, fields);
    if (!route?.accountId || !route.accNum) return result("skipped", { error: "TradeLocker could not discover an account. Add Account ID and Account number in Advanced Settings." });
    const request = autoTradeRequest("TRADELOCKER", trade, Number(route.accountId) || route.accountId, fields);
    const instrument = await discoverTradeLockerInstrument(token, route, request.symbol, fields);
    if (!instrument?.tradableInstrumentId) return result("skipped", { error: `TradeLocker could not discover instrument ${request.symbol}. Add Instrument ID in Advanced Settings.` });

    if (dryRunEnabled()) {
      const order = dryRunOrder(request, PROVIDER_NAME);
      return result("dry_run", { accountId: order.accountId, contractId: request.symbol, contractName: request.symbol, orders: [order] });
    }

    const response = await fetch(`${baseUrl(fields)}/trade/accounts/${route.accountId}/orders`, {
      body: JSON.stringify({
        price: request.entryType === "limit" ? request.entryPrice : 0,
        qty: request.size,
        routeId: instrument.routeId ?? "TRADE",
        side: request.action,
        stopLoss: request.stopLossPrice,
        takeProfit: request.takeProfitPrice,
        tradableInstrumentId: Number(instrument.tradableInstrumentId),
        type: request.entryType,
        validity: request.entryType === "market" ? "IOC" : "GTC"
      }),
      cache: "no-store",
      headers: {
        accNum: route.accNum,
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
    return result("failed", { error: message });
  }
}
