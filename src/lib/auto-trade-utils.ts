import { createHash } from "node:crypto";
import { defaultTickSize } from "@/lib/assets";
import type { ProjectXAutoTradeResult, ProjectXAutoTradeStatus } from "@/lib/projectx-auto-trader";
import type { AutoTradeOrderSummary, TradeAlert } from "@/lib/types";

export type ProviderPrefix = "CTRADER" | "MATCHTRADER" | "MT5" | "RITHMIC" | "TRADELOCKER" | "TRADOVATE";

export type AutoTradeRequest = {
  accountId?: number | string;
  action: "buy" | "sell";
  customTag: string;
  entryPrice: number;
  entryType: "limit" | "market";
  rawTrade: TradeAlert;
  size: number;
  stopLossPrice: number;
  symbol: string;
  takeProfitPrice: number;
};

export function envText(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function fieldText(fields: Record<string, string> | undefined, key: string, envName: string): string | undefined {
  return fields?.[key]?.trim() || envText(envName);
}

export function envFlag(name: string, fallback: boolean): boolean {
  const value = envText(name)?.toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

export function positiveNumberEnv(name: string): number | undefined {
  const value = Number(envText(name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function requiredEnv(names: string[]): string[] {
  return names.filter((name) => !envText(name));
}

export function parseEnvMap(name: string): Record<string, string> {
  const raw = envText(name);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => [key.trim().toUpperCase(), typeof value === "string" ? value.trim() : String(value)])
        .filter(([key, value]) => Boolean(key && value))
    );
  } catch {
    return Object.fromEntries(
      raw
        .split(",")
        .map((entry) => entry.split(":"))
        .map(([key, value]) => [key?.trim().toUpperCase() ?? "", value?.trim() ?? ""])
        .filter(([key, value]) => Boolean(key && value))
    );
  }
}

export function parseMap(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => [key.trim().toUpperCase(), typeof value === "string" ? value.trim() : String(value)])
        .filter(([key, value]) => Boolean(key && value))
    );
  } catch {
    return Object.fromEntries(
      raw
        .split(",")
        .map((entry) => entry.split(":"))
        .map(([key, value]) => [key?.trim().toUpperCase() ?? "", value?.trim() ?? ""])
        .filter(([key, value]) => Boolean(key && value))
    );
  }
}

export function mappedSymbol(prefix: ProviderPrefix, trade: TradeAlert): string {
  const symbol = trade.symbol.trim().toUpperCase();
  return parseEnvMap(`${prefix}_SYMBOL_MAP`)[symbol] ?? symbol;
}

export function mappedSymbolWithFields(prefix: ProviderPrefix, trade: TradeAlert, fields?: Record<string, string>): string {
  const symbol = trade.symbol.trim().toUpperCase();
  return parseMap(fields?.symbolMap)[symbol] ?? parseEnvMap(`${prefix}_SYMBOL_MAP`)[symbol] ?? symbol;
}

export function mappedSize(prefix: ProviderPrefix, trade: TradeAlert, fallback = trade.sizeMultiplier ?? 1, fields?: Record<string, string>): number {
  const symbol = trade.symbol.trim().toUpperCase();
  const mapped = Number(
    parseMap(fields?.sizeMap)[symbol] ?? parseMap(fields?.lotMap)[symbol] ?? parseEnvMap(`${prefix}_SIZE_MAP`)[symbol] ?? parseEnvMap(`${prefix}_LOT_MAP`)[symbol]
  );
  const size = Number.isFinite(mapped) && mapped > 0 ? mapped : fallback;
  return Number.isFinite(size) && size > 0 ? Number(size.toFixed(4)) : 1;
}

export function tradeLevels(trade: TradeAlert): Pick<AutoTradeRequest, "stopLossPrice" | "takeProfitPrice"> {
  const tickSize = defaultTickSize(trade.symbol, trade.market === "gold_spot" ? "gold_spot" : trade.market === "forex" ? "forex" : undefined);
  const direction = trade.side === "long" ? 1 : -1;
  const stopLossPrice = Number.isFinite(trade.stopLossPrice)
    ? trade.stopLossPrice
    : trade.entryPrice - direction * Math.abs(trade.slUnits) * tickSize;
  const takeProfitPrice = Number.isFinite(trade.takeProfitPrice)
    ? trade.takeProfitPrice
    : trade.entryPrice + direction * Math.abs(trade.tpUnits) * tickSize;
  return { stopLossPrice, takeProfitPrice };
}

export function autoTradeRequest(prefix: ProviderPrefix, trade: TradeAlert, accountId?: number | string, fields?: Record<string, string>): AutoTradeRequest {
  const customTag = createHash("sha256").update(`${prefix}:${trade.id}:${accountId ?? ""}`).digest("hex").slice(0, 24);
  return {
    ...tradeLevels(trade),
    accountId,
    action: trade.side === "long" ? "buy" : "sell",
    customTag: `tb_${customTag}`,
    entryPrice: trade.entryPrice,
    entryType: trade.entryType === "limit" ? "limit" : "market",
    rawTrade: trade,
    size: mappedSize(prefix, trade, trade.sizeMultiplier ?? 1, fields),
    symbol: mappedSymbolWithFields(prefix, trade, fields)
  };
}

export function result(
  status: ProjectXAutoTradeStatus,
  fields: Omit<ProjectXAutoTradeResult, "checkedAt" | "status"> = {}
): ProjectXAutoTradeResult {
  return {
    checkedAt: new Date().toISOString(),
    status,
    ...fields
  };
}

export function dryRunOrder(request: AutoTradeRequest, providerName: string): AutoTradeOrderSummary {
  return {
    accountId: typeof request.accountId === "number" ? request.accountId : 0,
    accountName: request.accountId ? String(request.accountId) : providerName,
    contractId: request.symbol,
    contractName: request.symbol,
    customTag: request.customTag,
    size: request.size,
    status: "dry_run"
  };
}

export function failedOrder(request: AutoTradeRequest, error: string): AutoTradeOrderSummary {
  return {
    accountId: typeof request.accountId === "number" ? request.accountId : 0,
    accountName: request.accountId ? String(request.accountId) : undefined,
    contractId: request.symbol,
    contractName: request.symbol,
    customTag: request.customTag,
    error,
    size: request.size,
    status: "failed"
  };
}

export function readableError(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

export async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const raw = await response.text();
  const parsed = raw ? (JSON.parse(raw) as T) : ({} as T);
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : parsed && typeof parsed === "object" && "errorText" in parsed && typeof parsed.errorText === "string"
          ? parsed.errorText
          : fallback;
    throw new Error(message);
  }
  return parsed;
}
