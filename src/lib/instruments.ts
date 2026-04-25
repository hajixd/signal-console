import { assetForSymbol } from "./assets";

type RecommendedSizeArgs = {
  symbol: string;
  currentMultiplier?: number;
  tpUnits?: number;
  slUnits?: number;
  minTargetDollars?: number;
  minRiskDollars?: number;
  maxRiskDollars?: number;
};

const DEFAULT_MIN_TARGET_DOLLARS = 300;
const DEFAULT_MIN_RISK_DOLLARS = 300;
const DEFAULT_MAX_RISK_DOLLARS = 1250;
const WHOLE_SIZE_STEP = 0.25;
const FRACTIONAL_SIZE_STEP = 0.01;

export function dollarPerUnit(symbol: string, _entryPrice?: number): number {
  return assetForSymbol(symbol)?.dollarPerUnit ?? 1;
}

function scaleSizeLabel(label: string, multiplier = 1): string {
  if (multiplier === 1) return label;
  const match = label.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (!match) return `${multiplier}x ${label}`;
  const scaled = Number((Number(match[1]) * multiplier).toFixed(2));
  return `${scaled} ${match[2]}`;
}

function roundUpToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function roundDownToStep(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

export function instrumentSizeLabel(symbol: string, multiplier = 1): string {
  return scaleSizeLabel(assetForSymbol(symbol)?.sizeLabel ?? "1 unit", multiplier);
}

export function instrumentUnitLabel(symbol: string): string {
  return assetForSymbol(symbol)?.unitLabel ?? "units";
}

export function recommendedSizeMultiplier({
  symbol,
  currentMultiplier = 1,
  tpUnits = 0,
  slUnits = 0,
  minTargetDollars = DEFAULT_MIN_TARGET_DOLLARS,
  minRiskDollars = DEFAULT_MIN_RISK_DOLLARS,
  maxRiskDollars = DEFAULT_MAX_RISK_DOLLARS
}: RecommendedSizeArgs): number {
  const baseMultiplier = Number.isFinite(currentMultiplier) && currentMultiplier > 0 ? currentMultiplier : 1;
  const dollarUnit = Math.abs(dollarPerUnit(symbol));
  if (!Number.isFinite(dollarUnit) || dollarUnit <= 0) return Math.ceil(baseMultiplier);

  const tpValue = Math.abs(tpUnits) * dollarUnit;
  const riskValue = Math.abs(slUnits) * dollarUnit;

  let minimumMultiplier = baseMultiplier;
  if (tpValue > 0) minimumMultiplier = Math.max(minimumMultiplier, minTargetDollars / tpValue);
  if (riskValue > 0) minimumMultiplier = Math.max(minimumMultiplier, minRiskDollars / riskValue);

  const maximumMultiplier = riskValue > 0 ? maxRiskDollars / riskValue : Number.POSITIVE_INFINITY;
  const step = minimumMultiplier < 1 || maximumMultiplier < 1 ? FRACTIONAL_SIZE_STEP : WHOLE_SIZE_STEP;
  const roundedUp = Math.max(step, roundUpToStep(minimumMultiplier, step));
  if (roundedUp <= maximumMultiplier || !Number.isFinite(maximumMultiplier)) {
    return Number(roundedUp.toFixed(2));
  }

  const roundedDown = Math.max(step, roundDownToStep(maximumMultiplier, step));
  return Number(roundedDown.toFixed(2));
}
