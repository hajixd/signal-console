import {
  autoTradeRequest,
  dryRunOrder,
  envFlag,
  envText,
  fieldText,
  failedOrder,
  nonExecutableOrderSizeReason,
  readJsonResponse,
  readableError,
  requiredEnv,
  result,
  skippedOrder,
  type ProviderPrefix
} from "@/lib/auto-trade-utils";
import { getAutoTradeConnection } from "@/lib/auto-trade-connections";
import type { AutoTradeProviderId } from "@/lib/auto-trade-platforms";
import type { ProjectXAutoTradeResult } from "@/lib/projectx-auto-trader";
import type { TradeAlert } from "@/lib/types";

type BridgeProvider = {
  accountEnv: string;
  dryRunEnv: string;
  enabledEnv: string;
  name: string;
  prefix: ProviderPrefix;
  providerId: AutoTradeProviderId;
  secretEnv: string;
  urlEnv: string;
};

type BridgeOrderResponse = {
  accountId?: number | string;
  accountName?: string;
  contractId?: string;
  contractName?: string;
  error?: string;
  orderId?: number;
  status?: "dry_run" | "failed" | "placed";
};

function missingBridgeSettings(fields: Record<string, string> | undefined, provider: BridgeProvider): string[] {
  return [
    ["bridgeUrl", provider.urlEnv],
    ["bridgeSecret", provider.secretEnv]
  ]
    .filter(([fieldKey, envName]) => !fieldText(fields, fieldKey, envName))
    .map(([fieldKey]) => fieldKey);
}

async function executeBridgeAutoTrade(provider: BridgeProvider, trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  if (!envFlag(provider.enabledEnv, true)) {
    return result("disabled", { error: `${provider.enabledEnv} is disabled.` });
  }

  const connection = await getAutoTradeConnection(provider.providerId);
  if (connection?.paused) return result("skipped", { error: `${provider.name} connection is paused.` });
  const fields = connection?.fields;
  const missing = missingBridgeSettings(fields, provider);
  const request = autoTradeRequest(provider.prefix, trade, fieldText(fields, "accountId", provider.accountEnv), fields);
  if (missing.length) return result("skipped", { error: `Missing ${provider.name} bridge settings: ${missing.join(", ")}.` });
  const sizeError = nonExecutableOrderSizeReason(request);
  if (sizeError) return result("skipped", { error: sizeError, orders: [skippedOrder(request, sizeError)] });

  if (envFlag(provider.dryRunEnv, false)) {
    const order = dryRunOrder(request, provider.name);
    return result("dry_run", { accountId: order.accountId, contractId: request.symbol, contractName: request.symbol, orders: [order] });
  }

  try {
    const response = await fetch(fieldText(fields, "bridgeUrl", provider.urlEnv)!, {
      body: JSON.stringify({
        accessToken: fields?.accessToken,
        accountId: request.accountId,
        action: request.action,
        customTag: request.customTag,
        entryPrice: request.entryPrice,
        entryType: request.entryType,
        gateway: fields?.gateway,
        login: fields?.login,
        password: fields?.password,
        refreshToken: fields?.refreshToken,
        secret: fieldText(fields, "bridgeSecret", provider.secretEnv),
        server: fields?.server,
        size: request.size,
        stopLossPrice: request.stopLossPrice,
        symbol: request.symbol,
        takeProfitPrice: request.takeProfitPrice,
        tradeId: trade.id
      }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const parsed = await readJsonResponse<BridgeOrderResponse>(response, `${provider.name} bridge order failed.`);
    if (parsed.status === "failed" || parsed.error) throw new Error(parsed.error ?? `${provider.name} bridge rejected the order.`);
    const orderId = parsed.orderId;
    const accountId = typeof parsed.accountId === "number" ? parsed.accountId : typeof request.accountId === "number" ? request.accountId : 0;
    return result("placed", {
      accountId,
      accountName: parsed.accountName ?? (request.accountId ? String(request.accountId) : undefined),
      contractId: parsed.contractId ?? request.symbol,
      contractName: parsed.contractName ?? request.symbol,
      orderId,
      orders: [
        {
          accountId,
          accountName: parsed.accountName ?? (request.accountId ? String(request.accountId) : provider.name),
          contractId: parsed.contractId ?? request.symbol,
          contractName: parsed.contractName ?? request.symbol,
          customTag: request.customTag,
          orderId,
          size: request.size,
          sizeUnit: request.sizeUnit,
          status: "placed"
        }
      ]
    });
  } catch (error) {
    const message = readableError(error, `${provider.name} bridge order failed.`);
    return result("failed", { error: message, orders: [failedOrder(request, message)] });
  }
}

export function mt5BridgeConfigured(): boolean {
  return requiredEnv(["MT5_BRIDGE_URL", "MT5_BRIDGE_SECRET"]).length === 0;
}

export function rithmicBridgeConfigured(): boolean {
  return requiredEnv(["RITHMIC_BRIDGE_URL", "RITHMIC_BRIDGE_SECRET"]).length === 0;
}

export function cTraderBridgeConfigured(): boolean {
  return requiredEnv(["CTRADER_BRIDGE_URL", "CTRADER_BRIDGE_SECRET"]).length === 0;
}

export function executeMt5BridgeAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  return executeBridgeAutoTrade(
    {
      accountEnv: "MT5_ACCOUNT_ID",
      dryRunEnv: "MT5_AUTO_TRADE_DRY_RUN",
      enabledEnv: "MT5_AUTO_TRADE_ENABLED",
      name: "MetaTrader 5 Bridge",
      prefix: "MT5",
      providerId: "mt5_bridge",
      secretEnv: "MT5_BRIDGE_SECRET",
      urlEnv: "MT5_BRIDGE_URL"
    },
    trade
  );
}

export function executeRithmicBridgeAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  return executeBridgeAutoTrade(
    {
      accountEnv: "RITHMIC_ACCOUNT_ID",
      dryRunEnv: "RITHMIC_AUTO_TRADE_DRY_RUN",
      enabledEnv: "RITHMIC_AUTO_TRADE_ENABLED",
      name: "Rithmic Bridge",
      prefix: "RITHMIC",
      providerId: "rithmic",
      secretEnv: "RITHMIC_BRIDGE_SECRET",
      urlEnv: "RITHMIC_BRIDGE_URL"
    },
    trade
  );
}

export function executeCTraderBridgeAutoTrade(trade: TradeAlert): Promise<ProjectXAutoTradeResult> {
  return executeBridgeAutoTrade(
    {
      accountEnv: "CTRADER_ACCOUNT_ID",
      dryRunEnv: "CTRADER_AUTO_TRADE_DRY_RUN",
      enabledEnv: "CTRADER_AUTO_TRADE_ENABLED",
      name: "cTrader Bridge",
      prefix: "CTRADER",
      providerId: "ctrader",
      secretEnv: "CTRADER_BRIDGE_SECRET",
      urlEnv: "CTRADER_BRIDGE_URL"
    },
    trade
  );
}
