import { createHash } from "node:crypto";
import { assetForKey, assetForSymbol, defaultTickSize } from "@/lib/assets";
import { customUnitSizeMultiplierForTrade } from "@/lib/custom-unit-sizing";
import type { ProjectXAutoTradeResult, ProjectXAutoTradeStatus } from "@/lib/projectx-auto-trader";
import type { AutoTradeOrderSummary, TradeAlert } from "@/lib/types";

export type ProviderPrefix = "CTRADER" | "MATCHTRADER" | "MT5" | "RITHMIC" | "TRADOVATE";

export type AutoTradeRequest = {
  accountId?: number | string;
  action: "buy" | "sell";
  customTag: string;
  entryPrice: number;
  entryType: "limit" | "market";
  rawTrade: TradeAlert;
  size: number;
  sizeStep: number;
  sizeUnit: NonNullable<AutoTradeOrderSummary["sizeUnit"]>;
  stopLossPrice: number;
  symbol: string;
  takeProfitPrice: number;
};

type AutoTradeAccountSizeSource = {
  accountName?: unknown;
  accountSize?: unknown;
  accountSpec?: unknown;
  balance?: unknown;
  challengeSize?: unknown;
  displayName?: unknown;
  firmLabel?: unknown;
  initialBalance?: unknown;
  label?: unknown;
  name?: unknown;
  startingBalance?: unknown;
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

function cleanNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function autoTradeAccountSizeScale(...sources: Array<AutoTradeAccountSizeSource | undefined>): number {
  for (const source of sources) {
    if (!source) continue;
    const numericSize = [
      source.accountSize,
      source.startingBalance,
      source.initialBalance,
      source.challengeSize,
      source.balance
    ]
      .map(cleanNumber)
      .find((value): value is number => value !== null && value > 0);
    if (numericSize && numericSize <= 50_000) return 0.5;

    const text = [
      source.accountName,
      source.accountSpec,
      source.displayName,
      source.firmLabel,
      source.label,
      source.name
    ]
      .map(textValue)
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (/(^|[^0-9])50\s*(?:k|,?000)([^0-9]|$)/.test(text)) return 0.5;
  }

  return 1;
}

function assetMarketForTrade(trade: Pick<TradeAlert, "assetKey" | "market" | "symbol">): string | undefined {
  if (trade.assetKey) {
    try {
      return assetForKey(trade.assetKey).market;
    } catch {
      return assetForSymbol(trade.symbol)?.market;
    }
  }
  return assetForSymbol(trade.symbol)?.market;
}

export function tradeRequiresWholeNumberSize(trade: Pick<TradeAlert, "assetKey" | "market" | "symbol">): boolean {
  return trade.market === "futures" || assetMarketForTrade(trade) === "futures";
}

export function scaledAutoTradeSize(
  baseSize: number,
  sources: AutoTradeAccountSizeSource | Array<AutoTradeAccountSizeSource | undefined> | undefined,
  options: { minSize?: number; wholeNumber?: boolean; wholeNumberRounding?: "ceil" | "floor" } = {}
): number {
  const normalizedBase = Number.isFinite(baseSize) && baseSize > 0 ? baseSize : 1;
  const sourceList = Array.isArray(sources) ? sources : [sources];
  const scaled = normalizedBase * autoTradeAccountSizeScale(...sourceList);
  if (options.wholeNumber) {
    const rounded = options.wholeNumberRounding === "floor" ? Math.floor(scaled) : Math.ceil(scaled);
    return Math.max(options.minSize ?? 1, rounded);
  }
  return Math.max(options.minSize ?? 0.0001, Number(scaled.toFixed(4)));
}

function positiveFiniteSize(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizedAutoTradeSizeCap(trade: TradeAlert, wholeNumber: boolean): number | null {
  const numeric = Number(trade.autoTradeSizeCap);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (wholeNumber) return Math.max(0, Math.floor(numeric + Number.EPSILON));
  return Math.max(0, Math.floor((numeric + Number.EPSILON) * 10_000) / 10_000);
}

function savedCustomSizeMultiplierForTrade(trade: TradeAlert, fallbackBaseSize: number): number | null {
  if (trade.sizeMode !== "custom") return null;
  return positiveFiniteSize(fallbackBaseSize);
}

export function scaledAutoTradeSizeForTrade(
  trade: TradeAlert,
  fallbackBaseSize: number,
  sources: AutoTradeAccountSizeSource | Array<AutoTradeAccountSizeSource | undefined> | undefined,
  options: { minSize?: number; wholeNumber?: boolean } = {}
): number {
  const sizeCap = normalizedAutoTradeSizeCap(trade, options.wholeNumber === true);
  const customSize = customUnitSizeMultiplierForTrade(trade) ?? savedCustomSizeMultiplierForTrade(trade, fallbackBaseSize);
  if (customSize !== null) {
    const size = scaledAutoTradeSize(customSize, undefined, {
      ...options,
      minSize: options.wholeNumber ? (options.minSize ?? 0) : options.minSize,
      wholeNumberRounding: options.wholeNumber ? "floor" : undefined
    });
    return sizeCap === null ? size : Math.min(size, sizeCap);
  }

  const size = scaledAutoTradeSize(fallbackBaseSize, sources, {
    ...options,
    wholeNumberRounding: undefined
  });
  return sizeCap === null ? size : Math.min(size, sizeCap);
}

export function plannedAutoTradeSizeForTrade(
  trade: TradeAlert,
  fallbackBaseSize = trade.sizeMultiplier ?? 1,
  sources: AutoTradeAccountSizeSource | Array<AutoTradeAccountSizeSource | undefined> | undefined = undefined
): number {
  const wholeNumber = tradeRequiresWholeNumberSize(trade);
  return scaledAutoTradeSizeForTrade(trade, fallbackBaseSize, sources, {
    minSize: wholeNumber ? 0 : undefined,
    wholeNumber
  });
}

function strategyLotsPerSizeUnit(trade: Pick<TradeAlert, "assetKey" | "market" | "symbol">): number {
  const market = trade.market || assetMarketForTrade(trade);
  return market === "forex" || market === "gold_spot" ? 0.1 : 1;
}

function baseUnitsPerStrategySizeUnit(trade: Pick<TradeAlert, "assetKey" | "market" | "symbol">): number {
  const market = trade.market || assetMarketForTrade(trade);
  if (market === "forex") return 10_000;
  if (market === "gold_spot") return 10;
  return 1;
}

function strategySizeFromOrderSize(order: AutoTradeOrderSummary, trade: TradeAlert): number {
  const size = Math.abs(order.size!);
  if (order.sizeUnit === "lots") return Number((size / strategyLotsPerSizeUnit(trade)).toFixed(8));
  if (order.sizeUnit === "base_units") return Number((size / baseUnitsPerStrategySizeUnit(trade)).toFixed(8));
  // Historical records predate size-unit metadata and already store the
  // strategy multiplier, so missing metadata must remain backward compatible.
  return size;
}

export function executableOrderSizeMultiplier(orders: AutoTradeOrderSummary[] | undefined, trade?: TradeAlert): number | undefined {
  const executableOrders = (orders ?? [])
    .filter(
      (order) =>
        (order.status === "placed" || order.status === "dry_run") &&
        typeof order.size === "number" &&
        Number.isFinite(order.size) &&
        order.size > 0
    );
  if (!executableOrders.length) return undefined;
  return executableOrders.reduce(
    (sum, order) => sum + (trade ? strategySizeFromOrderSize(order, trade) : Math.abs(order.size!)),
    0
  );
}

export function realAutoTradeSizeForTrade(
  trade: TradeAlert,
  fallbackBaseSize = trade.sizeMultiplier ?? 1,
  orders: AutoTradeOrderSummary[] | undefined = trade.autoTradeOrders
): number {
  return executableOrderSizeMultiplier(orders, trade) ?? plannedAutoTradeSizeForTrade(trade, fallbackBaseSize);
}

export function mappedSymbol(prefix: ProviderPrefix, trade: TradeAlert): string {
  const symbol = trade.symbol.trim().toUpperCase();
  return parseEnvMap(`${prefix}_SYMBOL_MAP`)[symbol] ?? symbol;
}

export function mappedSymbolWithFields(prefix: ProviderPrefix, trade: TradeAlert, fields?: Record<string, string>): string {
  const symbol = trade.symbol.trim().toUpperCase();
  return parseMap(fields?.symbolMap)[symbol] ?? parseEnvMap(`${prefix}_SYMBOL_MAP`)[symbol] ?? symbol;
}

function providerSizeUnit(prefix: ProviderPrefix): NonNullable<AutoTradeOrderSummary["sizeUnit"]> {
  if (prefix === "CTRADER") return "base_units";
  if (prefix === "MATCHTRADER" || prefix === "MT5") return "lots";
  return "strategy";
}

function providerSizeScale(prefix: ProviderPrefix, trade: TradeAlert): number {
  const unit = providerSizeUnit(prefix);
  if (unit === "lots") return strategyLotsPerSizeUnit(trade);
  if (unit === "base_units") return baseUnitsPerStrategySizeUnit(trade);
  return 1;
}

function configuredProviderSizeStep(prefix: ProviderPrefix, fields: Record<string, string> | undefined, unit: NonNullable<AutoTradeOrderSummary["sizeUnit"]>): number {
  const configured = Number(
    fields?.sizeStep ??
      fields?.lotStep ??
      fields?.volumeStep ??
      envText(`${prefix}_SIZE_STEP`) ??
      envText(`${prefix}_LOT_STEP`) ??
      envText(`${prefix}_VOLUME_STEP`)
  );
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (unit === "lots") return 0.01;
  if (unit === "base_units") return 1;
  return 1;
}

function roundProviderSizeDown(size: number, step: number): number {
  if (!(size > 0) || !(step > 0)) return 0;
  const steps = Math.floor((size + Number.EPSILON) / step);
  if (steps < 1) return 0;
  return Number((steps * step).toFixed(8));
}

function providerSizing(
  prefix: ProviderPrefix,
  trade: TradeAlert,
  fallback = trade.sizeMultiplier ?? 1,
  fields?: Record<string, string>
): { size: number; sizeStep: number; sizeUnit: NonNullable<AutoTradeOrderSummary["sizeUnit"]> } {
  const symbol = trade.symbol.trim().toUpperCase();
  const mapped = Number(
    parseMap(fields?.sizeMap)[symbol] ?? parseMap(fields?.lotMap)[symbol] ?? parseEnvMap(`${prefix}_SIZE_MAP`)[symbol] ?? parseEnvMap(`${prefix}_LOT_MAP`)[symbol]
  );
  const sizeUnit = providerSizeUnit(prefix);
  const scale = providerSizeScale(prefix, trade);
  const mappedStrategySize = Number.isFinite(mapped) && mapped > 0 ? mapped / scale : null;
  const fallbackStrategySize = mappedStrategySize ?? (Number.isFinite(fallback) && fallback > 0 ? fallback : 1);
  const strategySize = scaledAutoTradeSizeForTrade(trade, fallbackStrategySize, fields, {
    wholeNumber: tradeRequiresWholeNumberSize(trade)
  });
  const sizeStep = configuredProviderSizeStep(prefix, fields, sizeUnit);
  return { size: roundProviderSizeDown(strategySize * scale, sizeStep), sizeStep, sizeUnit };
}

export function mappedSize(prefix: ProviderPrefix, trade: TradeAlert, fallback = trade.sizeMultiplier ?? 1, fields?: Record<string, string>): number {
  return providerSizing(prefix, trade, fallback, fields).size;
}

export function adaptiveProviderSizeAttemptSequence(size: number, step: number): number[] {
  const normalizedStep = Number.isFinite(step) && step > 0 ? step : 0.01;
  const first = roundProviderSizeDown(size, normalizedStep);
  if (!(first > 0)) return [];
  const attempts = [first];
  let current = first;
  while (current > normalizedStep) {
    let next = roundProviderSizeDown(current / 2, normalizedStep);
    if (!(next > 0)) next = roundProviderSizeDown(normalizedStep, normalizedStep);
    if (!(next > 0) || next >= current) break;
    attempts.push(next);
    current = next;
  }
  return attempts;
}

export function executionSizeErrorAllowsRetry(message: string): boolean {
  return [
    /insufficient\s+(?:funds?|margin|buying\s+power|purchasing\s+power)/i,
    /not\s+enough\s+(?:funds?|margin|buying\s+power|purchasing\s+power)/i,
    /(?:exceeds?|exceeded|over)\s+(?:the\s+)?(?:maximum\s+)?(?:margin|contract|position|size|volume|risk)/i,
    /(?:max|maximum)\s+(?:margin|contracts?|position|position\s+size|order\s+size|volume)/i,
    /(?:contract|position|order\s+size|quantity|volume)\s+limit/i,
    /available\s+(?:margin|buying\s+power|purchasing\s+power).*(?:too\s+low|below|required|needed)/i
  ].some((pattern) => pattern.test(message));
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
  const sizing = providerSizing(prefix, trade, trade.sizeMultiplier ?? 1, fields);
  return {
    ...tradeLevels(trade),
    accountId,
    action: trade.side === "long" ? "buy" : "sell",
    customTag: `tb_${customTag}`,
    entryPrice: trade.entryPrice,
    entryType: trade.entryType === "limit" ? "limit" : "market",
    rawTrade: trade,
    size: sizing.size,
    sizeStep: sizing.sizeStep,
    sizeUnit: sizing.sizeUnit,
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
    sizeUnit: request.sizeUnit,
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
    sizeUnit: request.sizeUnit,
    status: "failed"
  };
}

export function skippedOrder(request: AutoTradeRequest, error: string): AutoTradeOrderSummary {
  return {
    accountId: typeof request.accountId === "number" ? request.accountId : 0,
    accountName: request.accountId ? String(request.accountId) : undefined,
    contractId: request.symbol,
    contractName: request.symbol,
    customTag: request.customTag,
    error,
    size: request.size,
    sizeUnit: request.sizeUnit,
    status: "skipped"
  };
}

export function nonExecutableOrderSizeReason(request: AutoTradeRequest): string | undefined {
  if (Number.isFinite(request.size) && request.size > 0) return undefined;
  return tradeRequiresWholeNumberSize(request.rawTrade)
    ? "Order skipped because the custom unit parameters leave no executable whole futures contract."
    : "Order size must be a positive number.";
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
