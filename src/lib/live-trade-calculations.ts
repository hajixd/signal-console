import { assetForSymbol } from "@/lib/assets";
import { dollarPerUnit } from "@/lib/instruments";
import type { AutoTradeOrderSummary, TradeAlert, TradeManagementEvent } from "@/lib/types";

export type LiveTradeEventOrderKind = "edit_limit" | "edit_sl" | "edit_tp" | "entry" | "limit" | "exit";

function finiteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function boundedTradeDollarPnl(rawPnlDollars: number, targetDollars: number, riskDollars: number): number {
  if (!Number.isFinite(rawPnlDollars)) return 0;
  const target = Math.abs(targetDollars);
  const risk = Math.abs(riskDollars);
  let bounded = rawPnlDollars;

  if (target > 0) bounded = Math.min(bounded, target);
  if (risk > 0) bounded = Math.max(bounded, -risk);

  return bounded;
}

export function inferredAlertPriceUnit(trade: TradeAlert, fallback = 1): number {
  const assetTickSize = assetForSymbol(trade.symbol)?.tickSize;
  if (assetTickSize !== undefined && assetTickSize > 0 && Number.isFinite(assetTickSize)) return assetTickSize;
  if (fallback > 0 && Number.isFinite(fallback)) return fallback;
  const targetDelta = Math.abs(trade.takeProfitPrice - trade.entryPrice);
  if (targetDelta > 0 && trade.tpUnits > 0) return targetDelta / trade.tpUnits;
  const stopDelta = Math.abs(trade.entryPrice - trade.stopLossPrice);
  if (stopDelta > 0 && trade.slUnits > 0) return stopDelta / trade.slUnits;
  return 1;
}

export function alertTargetUnits(trade: TradeAlert): number {
  const priceUnit = inferredAlertPriceUnit(trade, 0);
  const priceDelta = Math.abs(trade.takeProfitPrice - trade.entryPrice);
  return priceUnit > 0 && priceDelta > 0 ? priceDelta / priceUnit : trade.tpUnits;
}

export function alertRiskUnits(trade: TradeAlert): number {
  const priceUnit = inferredAlertPriceUnit(trade, 0);
  const priceDelta = Math.abs(trade.entryPrice - trade.stopLossPrice);
  return priceUnit > 0 && priceDelta > 0 ? priceDelta / priceUnit : trade.slUnits;
}

export function alertTargetDollarsWithSize(trade: TradeAlert, sizeMultiplier: number): number {
  return Math.abs(alertTargetUnits(trade) * dollarPerUnit(trade.symbol, trade.entryPrice) * sizeMultiplier);
}

export function alertRiskDollarsWithSize(trade: TradeAlert, sizeMultiplier: number): number {
  return Math.abs(alertRiskUnits(trade) * dollarPerUnit(trade.symbol, trade.entryPrice) * sizeMultiplier);
}

export function alertTargetDollars(trade: TradeAlert): number {
  return alertTargetDollarsWithSize(trade, trade.sizeMultiplier ?? 1);
}

export function alertRiskDollars(trade: TradeAlert): number {
  return alertRiskDollarsWithSize(trade, trade.sizeMultiplier ?? 1);
}

export function liveOpenTradePnlDollars(trade: TradeAlert, priceUnit: number, exitPrice: number, sizeMultiplier: number): number {
  if (!Number.isFinite(exitPrice) || priceUnit <= 0) return 0;
  const sideMultiplier = trade.side === "long" ? 1 : -1;
  const netUnits = ((exitPrice - trade.entryPrice) * sideMultiplier) / priceUnit;
  return netUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * sizeMultiplier;
}

export function liveClosedTradePnlDollars(
  trade: TradeAlert,
  sizeMultiplier: number,
  dollars: { riskDollars?: number; targetDollars?: number } = {}
): number {
  const targetDollars = dollars.targetDollars ?? alertTargetDollarsWithSize(trade, sizeMultiplier);
  const riskDollars = dollars.riskDollars ?? alertRiskDollarsWithSize(trade, sizeMultiplier);
  const rawPnlDollars =
    finiteNumber(trade.lifecycleRMultiple)
      ? trade.lifecycleRMultiple * riskDollars
      : finiteNumber(trade.lifecyclePnlDollars)
        ? trade.lifecyclePnlDollars
        : trade.lifecycleStatus === "take_profit"
          ? targetDollars
          : trade.lifecycleStatus === "stop_loss"
            ? -riskDollars
            : 0;

  return boundedTradeDollarPnl(rawPnlDollars, targetDollars, riskDollars);
}

export function liveTradeEventAutoTradeOrders(
  trade: TradeAlert,
  eventKind: LiveTradeEventOrderKind,
  managementEvent?: TradeManagementEvent
): AutoTradeOrderSummary[] | undefined {
  if (managementEvent) return managementEvent.autoTradeOrders;
  if (eventKind === "limit") return trade.limitOrderAutoTradeOrders?.length ? trade.limitOrderAutoTradeOrders : trade.autoTradeOrders;
  return trade.autoTradeOrders;
}
