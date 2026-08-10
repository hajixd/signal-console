import { oneMinuteBarsHeld } from "@/lib/trade-bracket-truth";

export type LiveTradeEstimateInput = {
  dollarsPerPricePoint: number;
  entryPrice: number;
  entryTime: string;
  fallbackBarsHeld?: number;
  markPrice: number;
  markTime: string;
  riskDollars: number;
  side: "long" | "short";
};

export type LiveTradeEstimate = {
  barsHeld: number;
  elapsedMinutes: number;
  markPrice: number;
  markTime: string;
  pnlDollars: number;
  rMultiple: number | null;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function liveTradeEstimate(input: LiveTradeEstimateInput): LiveTradeEstimate | null {
  const entryTimeMs = Date.parse(input.entryTime);
  const markTimeMs = Date.parse(input.markTime);
  if (
    !Number.isFinite(entryTimeMs) ||
    !Number.isFinite(markTimeMs) ||
    markTimeMs < entryTimeMs ||
    !Number.isFinite(input.entryPrice) ||
    !Number.isFinite(input.markPrice) ||
    !Number.isFinite(input.dollarsPerPricePoint) ||
    input.dollarsPerPricePoint <= 0
  ) {
    return null;
  }

  const direction = input.side === "long" ? 1 : -1;
  const pnlDollars = roundMoney((input.markPrice - input.entryPrice) * direction * input.dollarsPerPricePoint);
  const riskDollars = Math.abs(input.riskDollars);

  return {
    barsHeld: oneMinuteBarsHeld(input.entryTime, input.markTime, input.fallbackBarsHeld),
    elapsedMinutes: Math.max(0, (markTimeMs - entryTimeMs) / 60_000),
    markPrice: input.markPrice,
    markTime: new Date(markTimeMs).toISOString(),
    pnlDollars,
    rMultiple: Number.isFinite(riskDollars) && riskDollars > 0 ? pnlDollars / riskDollars : null
  };
}
