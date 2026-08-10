import type { TradeManagementEvent } from "@/lib/types";

export type TradeOutcomeConsistencyInput = {
  dollarsPerPricePoint: number;
  entryPrice: number;
  exitPrice: number;
  exitReason: string;
  exitTime?: string;
  managementEvents?: TradeManagementEvent[];
  pnlDollars: number;
  priceTolerance?: number;
  side: "long" | "short";
  stopPrice: number;
  targetPrice: number;
};

export type ConsistentTradeOutcome = {
  corrected: boolean;
  exitReason: string;
  pnlDollars: number;
  pricePnlDollars: number;
};

function normalizedBoundary(reason: string): "target" | "stop" | null {
  const normalized = reason.trim().toLowerCase();
  if (normalized === "tp" || normalized === "tp_gap" || normalized.includes("take") || normalized.includes("target")) return "target";
  if (normalized === "sl" || normalized === "sl_gap" || normalized.includes("stop")) return "stop";
  return null;
}

function activeLevelsAtExit(input: TradeOutcomeConsistencyInput): { stopPrice: number; targetPrice: number } {
  const exitTime = Date.parse(input.exitTime ?? "");
  let stopPrice = input.stopPrice;
  let targetPrice = input.targetPrice;
  for (const event of [...(input.managementEvents ?? [])].sort((left, right) => Date.parse(left.time) - Date.parse(right.time))) {
    const eventTime = Date.parse(event.time);
    if (Number.isFinite(exitTime) && Number.isFinite(eventTime) && eventTime > exitTime) continue;
    if (event.type === "edit_sl") stopPrice = event.price;
    if (event.type === "edit_tp") targetPrice = event.price;
  }
  return { stopPrice, targetPrice };
}

function pricesMatch(left: number, right: number, tolerance: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

/** Keeps a displayed price path, outcome label, and P&L from contradicting one another. */
export function consistentTradeOutcome(input: TradeOutcomeConsistencyInput): ConsistentTradeOutcome {
  const direction = input.side === "long" ? 1 : -1;
  const dollarsPerPricePoint = Math.max(0, input.dollarsPerPricePoint);
  const pricePnlDollars = (input.exitPrice - input.entryPrice) * direction * dollarsPerPricePoint;
  const moneyTolerance = 0.01;
  const rawSign = Math.abs(input.pnlDollars) <= moneyTolerance ? 0 : Math.sign(input.pnlDollars);
  const priceSign = Math.abs(pricePnlDollars) <= moneyTolerance ? 0 : Math.sign(pricePnlDollars);
  const signMismatch = rawSign !== 0 && priceSign !== 0 && rawSign !== priceSign;
  const pnlDollars = signMismatch ? pricePnlDollars : input.pnlDollars;

  const tolerance = Math.max(input.priceTolerance ?? 0, Math.abs(input.entryPrice) * 1e-9, 1e-9);
  const activeLevels = activeLevelsAtExit(input);
  const boundary = normalizedBoundary(input.exitReason);
  let exitReason = input.exitReason;
  if (pricesMatch(input.exitPrice, activeLevels.stopPrice, tolerance)) {
    exitReason = "stop_loss";
  } else if (pricesMatch(input.exitPrice, activeLevels.targetPrice, tolerance)) {
    exitReason = "take_profit";
  } else if (boundary === "target" && priceSign < 0) {
    exitReason = "stop_loss";
  }

  return {
    corrected: signMismatch || exitReason !== input.exitReason,
    exitReason,
    pnlDollars,
    pricePnlDollars
  };
}
