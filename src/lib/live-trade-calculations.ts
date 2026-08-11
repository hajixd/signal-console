import { assetForSymbol } from "@/lib/assets";
import { executableOrderSizeMultiplier } from "@/lib/auto-trade-utils";
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

export function liveOpenTradePnlDollars(
  trade: TradeAlert,
  priceUnit: number,
  exitPrice: number,
  sizeMultiplier: number,
  entryPrice = trade.entryPrice
): number {
  if (!Number.isFinite(exitPrice) || priceUnit <= 0) return 0;
  const sideMultiplier = trade.side === "long" ? 1 : -1;
  const netUnits = ((exitPrice - entryPrice) * sideMultiplier) / priceUnit;
  return netUnits * dollarPerUnit(trade.symbol, entryPrice) * sizeMultiplier;
}

export type LiveBrokerEntryOutcome = {
  entryPrice: number;
  entryTime?: string;
  sizeMultiplier: number;
};

function validTimestamp(value: string | undefined): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Resolve the actual broker fill while a trade is still open. */
export function liveBrokerEntryOutcome(trade: TradeAlert): LiveBrokerEntryOutcome | null {
  const filledOrders = (trade.autoTradeOrders ?? []).filter(
    (order) => order.status === "placed" && finiteNumber(order.filledPrice)
  );
  if (!filledOrders.length) return null;

  let weightedEntryPrice = 0;
  let totalWeight = 0;
  let sizeMultiplier = 0;
  const fillTimes: string[] = [];

  for (const order of filledOrders) {
    const orderSize = strategySizeFromBrokerOrder(order, trade);
    const weight = orderSize > 0 ? orderSize : 1;
    weightedEntryPrice += order.filledPrice! * weight;
    totalWeight += weight;
    sizeMultiplier += Math.max(0, orderSize);
    if (validTimestamp(order.filledTime)) fillTimes.push(order.filledTime);
  }

  const fallbackTime = [trade.autoTradeCheckedAt, trade.createdAt, trade.signalTime].find(validTimestamp);
  return {
    entryPrice: weightedEntryPrice / totalWeight,
    entryTime: fillTimes.sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? fallbackTime,
    sizeMultiplier
  };
}

export type LiveBrokerExecutionOutcome = {
  entryPrice?: number;
  entryTime?: string;
  exitPrice?: number;
  exitTime?: string;
  feesDollars: number;
  grossPnlDollars: number;
  netPnlDollars: number;
  sizeMultiplier: number;
};

export type BrokerExecutionLifecycleStatus = Exclude<NonNullable<TradeAlert["lifecycleStatus"]>, "open">;

function brokerExitLevels(trade: TradeAlert, exitTime: string | undefined): { stopPrice: number; targetPrice: number } {
  const exitMs = Date.parse(exitTime ?? "");
  let stopPrice = trade.stopLossPrice;
  let targetPrice = trade.takeProfitPrice;

  for (const event of [...(trade.managementEvents ?? [])].sort((left, right) => Date.parse(left.time) - Date.parse(right.time))) {
    const eventMs = Date.parse(event.time);
    if (!Number.isFinite(eventMs) || !Number.isFinite(exitMs) || eventMs > exitMs) break;
    if (event.type === "edit_sl") stopPrice = event.stopLossPrice ?? event.price;
    if (event.type === "edit_tp") targetPrice = event.takeProfitPrice ?? event.price;
  }

  return { stopPrice, targetPrice };
}

/**
 * Classify the actual broker exit by the price level it reached, never by the
 * sign of its P&L. A manual, risk-system, or externally initiated close can be
 * a loss without ever touching the strategy stop.
 */
export function brokerExecutionLifecycleStatus(
  trade: TradeAlert,
  outcome: LiveBrokerExecutionOutcome | null = liveBrokerExecutionOutcome(trade)
): BrokerExecutionLifecycleStatus {
  const exitPrice = outcome?.exitPrice;
  if (!finiteNumber(exitPrice)) {
    return trade.lifecycleStatus && trade.lifecycleStatus !== "open" ? trade.lifecycleStatus : "broker_close";
  }

  const levels = brokerExitLevels(trade, outcome?.exitTime);
  const tolerance = Math.max(Number.EPSILON, inferredAlertPriceUnit(trade, 0) / 2);
  const targetHit = trade.side === "long"
    ? exitPrice >= levels.targetPrice - tolerance
    : exitPrice <= levels.targetPrice + tolerance;
  const stopHit = trade.side === "long"
    ? exitPrice <= levels.stopPrice + tolerance
    : exitPrice >= levels.stopPrice - tolerance;

  if (stopHit) return "stop_loss";
  if (targetHit) return "take_profit";
  if (trade.lifecycleStatus === "max_bars") return "max_bars";
  return "broker_close";
}

function strategySizeFromBrokerOrder(order: AutoTradeOrderSummary, trade: TradeAlert): number {
  return executableOrderSizeMultiplier([order], trade) ?? 0;
}

/**
 * Resolve the broker-reported result into chart coordinates. New execution
 * records carry the closing fill directly. Older ProjectX records can still
 * recover it from the opening fill, gross P&L, contract size, and tick value.
 */
export function liveBrokerExecutionOutcome(trade: TradeAlert): LiveBrokerExecutionOutcome | null {
  const resultOrders = (trade.autoTradeOrders ?? []).filter(
    (order) => order.status === "placed" && finiteNumber(order.netPnlDollars)
  );
  if (!resultOrders.length) return null;

  const priceUnit = inferredAlertPriceUnit(trade, 0);
  const dollarsPerPointPerStrategyUnit = priceUnit > 0
    ? dollarPerUnit(trade.symbol, trade.entryPrice) / priceUnit
    : 0;
  const direction = trade.side === "long" ? 1 : -1;
  let feesDollars = 0;
  let grossPnlDollars = 0;
  let netPnlDollars = 0;
  let sizeMultiplier = 0;
  let weightedEntryPrice = 0;
  let weightedExitPrice = 0;
  let totalPriceWeight = 0;
  let totalExitPriceWeight = 0;
  const exitTimes: string[] = [];

  for (const order of resultOrders) {
    const net = order.netPnlDollars!;
    const fees = finiteNumber(order.feesDollars) ? order.feesDollars : 0;
    const gross = finiteNumber(order.grossPnlDollars) ? order.grossPnlDollars : net + fees;
    const orderSize = strategySizeFromBrokerOrder(order, trade);
    const entryPrice = finiteNumber(order.filledPrice) ? order.filledPrice : trade.entryPrice;
    const priceWeight = orderSize * dollarsPerPointPerStrategyUnit;
    const inferredExitPrice =
      finiteNumber(order.exitPrice)
        ? order.exitPrice
        : priceWeight > 0
          ? entryPrice + direction * (gross / priceWeight)
          : undefined;

    feesDollars += fees;
    grossPnlDollars += gross;
    netPnlDollars += net;
    sizeMultiplier += orderSize;
    if (priceWeight > 0) {
      weightedEntryPrice += entryPrice * priceWeight;
      if (finiteNumber(inferredExitPrice)) {
        weightedExitPrice += inferredExitPrice * priceWeight;
        totalExitPriceWeight += priceWeight;
      }
      totalPriceWeight += priceWeight;
    }
    const exitTime = order.exitTime?.trim();
    if (exitTime && Number.isFinite(Date.parse(exitTime))) exitTimes.push(exitTime);
  }

  const brokerEntry = liveBrokerEntryOutcome(trade);
  return {
    entryPrice: totalPriceWeight > 0 ? weightedEntryPrice / totalPriceWeight : undefined,
    entryTime: brokerEntry?.entryTime,
    exitPrice: totalExitPriceWeight > 0 ? weightedExitPrice / totalExitPriceWeight : undefined,
    exitTime: exitTimes.sort((left, right) => Date.parse(right) - Date.parse(left))[0],
    feesDollars,
    grossPnlDollars,
    netPnlDollars,
    sizeMultiplier
  };
}

export function liveClosedTradePnlDollars(
  trade: TradeAlert,
  sizeMultiplier: number,
  dollars: { riskDollars?: number; targetDollars?: number } = {}
): number {
  const brokerOutcome = liveBrokerExecutionOutcome(trade);
  if (brokerOutcome) return brokerOutcome.netPnlDollars;

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
