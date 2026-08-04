import { plannedAutoTradeSizeForTrade, tradeRequiresWholeNumberSize } from "@/lib/auto-trade-utils";
import { dollarPerUnit } from "@/lib/instruments";
import type { TradeAlert } from "@/lib/types";

export type AutoTradeSizeLimits = {
  maxRiskDollars?: number;
  maxSize?: number;
  maxTargetDollars?: number;
  targetLimitExclusive?: boolean;
};

export type AutoTradeSizeAdjustment = {
  adjusted: boolean;
  originalRiskDollars: number;
  originalSize: number;
  originalTargetDollars: number;
  riskDollars: number;
  size: number;
  targetDollars: number;
  trade: TradeAlert;
};

function finiteNonNegative(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function roundedDownSize(trade: TradeAlert, value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (tradeRequiresWholeNumberSize(trade)) return Math.max(0, Math.floor(value + Number.EPSILON));
  return Math.max(0, Math.floor((value + Number.EPSILON) * 10_000) / 10_000);
}

function exclusiveDollarLimit(value: number): number {
  return Math.max(0, value - Math.max(1e-8, Math.abs(value) * 1e-12));
}

export function adjustAutoTradeSizeToLimits(trade: TradeAlert, limits: AutoTradeSizeLimits): AutoTradeSizeAdjustment {
  const originalSize = plannedAutoTradeSizeForTrade(trade);
  const dollarUnit = Math.abs(dollarPerUnit(trade.symbol, trade.entryPrice));
  const riskPerSize = Math.abs(trade.slUnits * dollarUnit);
  const targetPerSize = Math.abs(trade.tpUnits * dollarUnit);
  const originalRiskDollars = riskPerSize * originalSize;
  const originalTargetDollars = targetPerSize * originalSize;
  let rawSizeCap = originalSize;

  const maxSize = finiteNonNegative(limits.maxSize);
  if (maxSize !== undefined) rawSizeCap = Math.min(rawSizeCap, maxSize);

  const maxRiskDollars = finiteNonNegative(limits.maxRiskDollars);
  if (maxRiskDollars !== undefined && riskPerSize > 0) {
    rawSizeCap = Math.min(rawSizeCap, maxRiskDollars / riskPerSize);
  }

  const maxTargetDollars = finiteNonNegative(limits.maxTargetDollars);
  if (maxTargetDollars !== undefined && targetPerSize > 0) {
    const targetLimit = limits.targetLimitExclusive ? exclusiveDollarLimit(maxTargetDollars) : maxTargetDollars;
    rawSizeCap = Math.min(rawSizeCap, targetLimit / targetPerSize);
  }

  const size = roundedDownSize(trade, rawSizeCap);
  const existingCap = finiteNonNegative(trade.autoTradeSizeCap);
  const autoTradeSizeCap = existingCap === undefined ? size : Math.min(existingCap, size);
  const adjustedTrade = size + 1e-9 < originalSize ? { ...trade, autoTradeSizeCap } : trade;
  const executableSize = plannedAutoTradeSizeForTrade(adjustedTrade);

  return {
    adjusted: executableSize + 1e-9 < originalSize,
    originalRiskDollars,
    originalSize,
    originalTargetDollars,
    riskDollars: riskPerSize * executableSize,
    size: executableSize,
    targetDollars: targetPerSize * executableSize,
    trade: adjustedTrade
  };
}
