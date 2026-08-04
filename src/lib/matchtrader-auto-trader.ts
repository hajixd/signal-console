import {
  adaptiveProviderSizeAttemptSequence,
  autoTradeRequest,
  dryRunOrder,
  envFlag,
  envText,
  fieldText,
  failedOrder,
  executionSizeErrorAllowsRetry,
  nonExecutableOrderSizeReason,
  readJsonResponse,
  readableError,
  requiredEnv,
  result,
  skippedOrder
} from "@/lib/auto-trade-utils";
import { getAutoTradeConnection } from "@/lib/auto-trade-connections";
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

function platformUrl(fields?: Record<string, string>): string {
  return fieldText(fields, "platformUrl", "MATCHTRADER_PLATFORM_URL")!.replace(/\/+$/g, "");
}

function endpoint(path: string, fields?: Record<string, string>): string {
  return `${platformUrl(fields)}/mtr-api/${fieldText(fields, "systemUuid", "MATCHTRADER_SYSTEM_UUID")}/${path.replace(/^\/+/g, "")}`;
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

  const connection = await getAutoTradeConnection("matchtrader");
  if (connection?.paused) return result("skipped", { error: "Match-Trader connection is paused." });
  const fields = connection?.fields;
  const requiredMissing = [
    ["platformUrl", "MATCHTRADER_PLATFORM_URL"],
    ["systemUuid", "MATCHTRADER_SYSTEM_UUID"],
    ["tradingApiToken", "MATCHTRADER_TRADING_API_TOKEN"]
  ]
    .filter(([key, envName]) => !fieldText(fields, key, envName))
    .map(([key]) => key);
  if (requiredMissing.length) return result("skipped", { error: `Missing Match-Trader credentials: ${requiredMissing.join(", ")}.` });

  let request = autoTradeRequest("MATCHTRADER", trade, fieldText(fields, "accountId", "MATCHTRADER_ACCOUNT_ID"), fields);
  const sizeError = nonExecutableOrderSizeReason(request);
  if (sizeError) return result("skipped", { error: sizeError, orders: [skippedOrder(request, sizeError)] });

  if (dryRunEnabled()) {
    const order = dryRunOrder(request, PROVIDER_NAME);
    return result("dry_run", { accountId: order.accountId, contractId: request.symbol, contractName: request.symbol, orders: [order] });
  }

  try {
    const plannedSize = request.size;
    let priorSizeError: string | undefined;
    const attempts = adaptiveProviderSizeAttemptSequence(request.size, request.sizeStep);
    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      request = { ...request, size: attempts[attemptIndex] };
      try {
        const response = await fetch(endpoint(request.entryType === "limit" ? "/pending-order/create" : "/position/open", fields), {
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
            "auth-trading-api": fieldText(fields, "tradingApiToken", "MATCHTRADER_TRADING_API_TOKEN")!,
            "content-type": "application/json",
            ...(fieldText(fields, "coAuthCookie", "MATCHTRADER_CO_AUTH_COOKIE") ? { cookie: `co-auth=${fieldText(fields, "coAuthCookie", "MATCHTRADER_CO_AUTH_COOKIE")}` } : {})
          },
          method: "POST"
        });
        const parsed = await readJsonResponse<MatchTraderOrderResponse>(response, "Match-Trader order placement failed.");
        if (parsed.status === "REJECTED" || parsed.errorMessage) throw new Error(parsed.errorMessage ?? "Match-Trader rejected the order.");
        const orderId = parsed.orderId;
        const retryNote = priorSizeError
          ? `Match-Trader reduced broker size from ${plannedSize} to ${request.size} after a size-related rejection. Previous rejection: ${priorSizeError}`
          : undefined;
        return result("placed", {
          contractId: request.symbol,
          contractName: request.symbol,
          orderId,
          orders: [
            {
              ...dryRunOrder(request, PROVIDER_NAME),
              error: retryNote,
              orderId,
              status: "placed"
            }
          ]
        });
      } catch (error) {
        const message = readableError(error, "Match-Trader order placement failed.");
        if (attemptIndex < attempts.length - 1 && executionSizeErrorAllowsRetry(message)) {
          priorSizeError = message;
          continue;
        }
        throw error;
      }
    }
    throw new Error("Match-Trader order placement failed after size-reduction attempts.");
  } catch (error) {
    const message = readableError(error, "Match-Trader order placement failed.");
    return result("failed", { error: message, orders: [failedOrder(request, message)] });
  }
}
