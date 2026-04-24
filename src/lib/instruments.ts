type FixedDollarSpec = {
  dollarPerUnit: number;
  sizeLabel: string;
  unitLabel: string;
};

type RecommendedSizeArgs = {
  symbol: string;
  currentMultiplier?: number;
  tpUnits?: number;
  slUnits?: number;
  costUnits?: number;
  minTargetDollars?: number;
  minRiskDollars?: number;
  maxRiskDollars?: number;
};

const FIXED_SPECS: Record<string, FixedDollarSpec> = {
  "6A": { dollarPerUnit: 0.5, sizeLabel: "1 micro FX future", unitLabel: "ticks" },
  "6B": { dollarPerUnit: 0.625, sizeLabel: "1 micro FX future", unitLabel: "ticks" },
  "6C": { dollarPerUnit: 0.5, sizeLabel: "1 micro FX future", unitLabel: "ticks" },
  "6E": { dollarPerUnit: 0.625, sizeLabel: "1 micro FX future", unitLabel: "ticks" },
  "6J": { dollarPerUnit: 0.625, sizeLabel: "1 micro FX future", unitLabel: "ticks" },
  CL: { dollarPerUnit: 1, sizeLabel: "1 MCL micro", unitLabel: "ticks" },
  ES: { dollarPerUnit: 1.25, sizeLabel: "1 MES micro", unitLabel: "ticks" },
  GC: { dollarPerUnit: 1, sizeLabel: "1 MGC micro", unitLabel: "ticks" },
  HG: { dollarPerUnit: 1.25, sizeLabel: "1 MHG micro", unitLabel: "ticks" },
  NG: { dollarPerUnit: 2.5, sizeLabel: "1 QG mini", unitLabel: "ticks" },
  NQ: { dollarPerUnit: 0.5, sizeLabel: "1 MNQ micro", unitLabel: "ticks" },
  RTY: { dollarPerUnit: 0.5, sizeLabel: "1 M2K micro", unitLabel: "ticks" },
  SI: { dollarPerUnit: 5, sizeLabel: "1 SIL micro", unitLabel: "ticks" },
  YM: { dollarPerUnit: 0.5, sizeLabel: "1 MYM micro", unitLabel: "ticks" },
  ZB: { dollarPerUnit: 31.25, sizeLabel: "1 futures contract", unitLabel: "ticks" },
  ZN: { dollarPerUnit: 15.625, sizeLabel: "1 futures contract", unitLabel: "ticks" },
  XAUUSD: { dollarPerUnit: 0.1, sizeLabel: "10 oz spot", unitLabel: "pips" }
};

const USD_QUOTE_FOREX = new Set(["AUDUSD", "EURUSD", "GBPUSD", "NZDUSD"]);
const USD_BASE_FOREX = new Set(["USDCAD", "USDCHF", "USDJPY"]);
const DEFAULT_MIN_TARGET_DOLLARS = 300;
const DEFAULT_MIN_RISK_DOLLARS = 300;
const DEFAULT_MAX_RISK_DOLLARS = 1250;
const WHOLE_SIZE_STEP = 0.25;
const FRACTIONAL_SIZE_STEP = 0.01;

function fallbackForexPrice(symbol: string): number {
  if (symbol === "USDJPY") return 150;
  if (symbol === "USDCHF") return 0.9;
  if (symbol === "USDCAD") return 1.36;
  return 1;
}

export function dollarPerUnit(symbol: string, price?: number): number {
  const fixed = FIXED_SPECS[symbol];
  if (fixed) return fixed.dollarPerUnit;
  if (USD_QUOTE_FOREX.has(symbol)) return 1;
  if (USD_BASE_FOREX.has(symbol)) {
    const referencePrice = price && price > 0 ? price : fallbackForexPrice(symbol);
    const quotePipValue = symbol === "USDJPY" ? 1000 : 10;
    return (quotePipValue / referencePrice) * 0.1;
  }
  return 1;
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
  const fixed = FIXED_SPECS[symbol];
  if (fixed) return scaleSizeLabel(fixed.sizeLabel, multiplier);
  if (USD_QUOTE_FOREX.has(symbol) || USD_BASE_FOREX.has(symbol)) return scaleSizeLabel("0.1 FX lot", multiplier);
  return scaleSizeLabel("1 unit", multiplier);
}

export function instrumentUnitLabel(symbol: string): string {
  const fixed = FIXED_SPECS[symbol];
  if (fixed) return fixed.unitLabel;
  if (USD_QUOTE_FOREX.has(symbol) || USD_BASE_FOREX.has(symbol)) return "pips";
  return "units";
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
