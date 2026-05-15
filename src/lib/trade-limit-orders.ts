import type { TradeAlert } from "@/lib/types";

const SUPPLEMENTAL_LIMIT_SHARE = 0.5;

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inferredTickSize(trade: TradeAlert): number {
  const stopDistance = Math.abs(trade.entryPrice - trade.stopLossPrice);
  if (stopDistance > 0 && trade.slUnits > 0) return stopDistance / trade.slUnits;

  const targetDistance = Math.abs(trade.takeProfitPrice - trade.entryPrice);
  if (targetDistance > 0 && trade.tpUnits > 0) return targetDistance / trade.tpUnits;

  return 1;
}

function roundToTick(value: number, tickSize: number): number {
  if (!(tickSize > 0) || !Number.isFinite(tickSize)) return value;
  const rounded = Math.round(value / tickSize) * tickSize;
  return Number(rounded.toFixed(10));
}

export function hasSupplementalLimitOrder(trade: TradeAlert): boolean {
  if (trade.entryType === "limit") return false;
  const fingerprint = `${trade.entryMode} ${trade.strategy} ${trade.notes ?? ""}`.toLowerCase();
  return (
    fingerprint.includes("50% retrace limit") ||
    fingerprint.includes("50% market") && fingerprint.includes("limit") ||
    fingerprint.includes("retrace limit at -0.5r")
  );
}

export function supplementalLimitOrderPrice(trade: TradeAlert): number | null {
  if (!hasSupplementalLimitOrder(trade)) return null;
  const risk = Math.abs(trade.entryPrice - trade.stopLossPrice);
  if (!(risk > 0)) return null;

  const direction = trade.side === "long" ? 1 : -1;
  const tickSize = inferredTickSize(trade);
  const limitPrice = roundToTick(trade.entryPrice - direction * risk * SUPPLEMENTAL_LIMIT_SHARE, tickSize);
  const isBetweenEntryAndStop =
    trade.side === "long"
      ? trade.stopLossPrice < limitPrice && limitPrice < trade.entryPrice
      : trade.entryPrice < limitPrice && limitPrice < trade.stopLossPrice;

  return isBetweenEntryAndStop ? limitPrice : null;
}

export function primaryOrderSizeMultiplier(trade: TradeAlert): number {
  const sizeMultiplier = trade.sizeMultiplier ?? 1;
  return hasSupplementalLimitOrder(trade) ? Math.max(0.01, sizeMultiplier * SUPPLEMENTAL_LIMIT_SHARE) : sizeMultiplier;
}

export function supplementalLimitOrderSizeMultiplier(trade: TradeAlert): number {
  return Math.max(0.01, (trade.sizeMultiplier ?? 1) * SUPPLEMENTAL_LIMIT_SHARE);
}

export function buildSupplementalLimitOrderTrade(trade: TradeAlert): TradeAlert | null {
  const limitPrice = supplementalLimitOrderPrice(trade);
  if (!finiteNumber(limitPrice)) return null;

  const tickSize = inferredTickSize(trade);
  const tpUnits = Math.abs(trade.takeProfitPrice - limitPrice) / tickSize;
  const slUnits = Math.abs(limitPrice - trade.stopLossPrice) / tickSize;
  if (!(tpUnits > 0) || !(slUnits > 0)) return null;

  return {
    ...trade,
    autoTradeAccountId: undefined,
    autoTradeAccountName: undefined,
    autoTradeCheckedAt: undefined,
    autoTradeContractId: undefined,
    autoTradeContractName: undefined,
    autoTradeCustomTag: undefined,
    autoTradeError: undefined,
    autoTradeOrderId: undefined,
    autoTradeOrders: undefined,
    autoTradeProviderId: undefined,
    autoTradeProviderName: undefined,
    autoTradeStatus: undefined,
    entryMode: "Supplemental retrace limit order with attached TP/SL",
    entryPrice: limitPrice,
    entryType: "limit",
    id: `${trade.id}:limit`,
    limitOrderPrice: undefined,
    limitOrderSizeMultiplier: undefined,
    limitOrderTelegramError: undefined,
    limitOrderTelegramStatus: undefined,
    notes: trade.notes ? `${trade.notes} Supplemental limit leg.` : "Supplemental limit leg.",
    sizeMultiplier: supplementalLimitOrderSizeMultiplier(trade),
    slUnits,
    status: "alerted",
    telegramError: undefined,
    telegramStatus: "skipped",
    tpUnits
  };
}
