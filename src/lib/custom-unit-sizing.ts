import { dollarPerUnit } from "@/lib/instruments";
import type { CustomScaleRange } from "@/lib/types";

type CustomUnitTrade = {
  customScaleRange?: CustomScaleRange;
  slUnits: number;
  symbol: string;
  tpUnits: number;
};

type ParsedCustomScaleRange = {
  riskCeiling: number;
  riskFloor: number;
  targetCeiling: number;
  targetFloor: number;
};

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function parseCustomScaleRange(range: CustomScaleRange | undefined): ParsedCustomScaleRange | null {
  if (!range) return null;
  const targetFloor = positiveNumber(range.targetFloor);
  const targetCeiling = positiveNumber(range.targetCeiling);
  const riskFloor = positiveNumber(range.riskFloor);
  const riskCeiling = positiveNumber(range.riskCeiling);

  if (!targetFloor || !targetCeiling || !riskFloor || !riskCeiling) return null;
  if (targetFloor > targetCeiling || riskFloor > riskCeiling) return null;
  return { riskCeiling, riskFloor, targetCeiling, targetFloor };
}

function roundDown(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.floor((value + Number.EPSILON) * factor) / factor;
}

export function customUnitSizeMultiplierForTrade(trade: CustomUnitTrade): number | null {
  const range = parseCustomScaleRange(trade.customScaleRange);
  const dollarUnit = Math.abs(dollarPerUnit(trade.symbol));
  const targetAtOne = Math.abs(trade.tpUnits * dollarUnit);
  const riskAtOne = Math.abs(trade.slUnits * dollarUnit);
  if (!range || !(targetAtOne > 0) || !(riskAtOne > 0)) return null;

  // Recalculate from this trade's actual target and stop. The largest
  // ceiling-safe size also satisfies both floors whenever the ranges overlap.
  const size = Math.min(range.targetCeiling / targetAtOne, range.riskCeiling / riskAtOne);
  return Number.isFinite(size) && size > 0 ? roundDown(size, 6) : null;
}
