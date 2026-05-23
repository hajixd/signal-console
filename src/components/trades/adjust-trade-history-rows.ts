"use client";

import {
  strategyContractScale,
  type StrategyEditMap,
  type StrategyEditOption
} from "@/components/strategies/strategy-edits-store";
import { type TradeHistoryRow } from "@/components/trades/trade-history";
import { instrumentSizeLabel } from "@/lib/instruments";

function fmtMoney(value: number, signed = false): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  });
  const formatted = formatter.format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

function resultClass(value: number): string {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "neutral";
}

function resultRowClass(value: number): string {
  if (value > 0) return "up-row";
  if (value < 0) return "down-row";
  return "neutral-row";
}

export function adjustTradeHistoryRows(
  rows: TradeHistoryRow[],
  strategies: StrategyEditOption[],
  edits: StrategyEditMap,
  customScaleRange?: CustomScaleRangeSeed
): TradeHistoryRow[] {
  const strategyByKey = new Map(strategies.map((strategy) => [strategy.key, strategy]));
  const customRange = parseCustomScaleRange(customScaleRange);

  return rows.map((row) => {
    const strategy = strategyByKey.get(row.strategyKey);
    if (row.lockedSize) return row;
    if (!strategy) return row;

    const scale = customRange ? rowCustomRangeScale(row, customRange) : strategyContractScale(strategy, edits);
    const pnlDollars = row.pnlDollars * scale;
    const targetDollars = row.targetDollars * scale;
    const riskDollars = row.riskDollars * scale;
    const rMultiple = riskDollars > 0 ? pnlDollars / riskDollars : 0;

    return {
      ...row,
      rowClassName: resultRowClass(pnlDollars),
      pnlClassName: resultClass(pnlDollars),
      pnlDollars,
      pnlLabel: fmtMoney(pnlDollars, true),
      rMultipleLabel: `${rMultiple.toLocaleString(undefined, {
        minimumFractionDigits: Number.isInteger(rMultiple) ? 0 : 2,
        maximumFractionDigits: 2
      })}R`,
      sizeLabel: instrumentSizeLabel(row.symbol, row.sizeMultiplier * scale),
      targetRiskLabel: `${fmtMoney(targetDollars)} / ${fmtMoney(-riskDollars)}`,
      targetLabel: fmtMoney(targetDollars),
      riskLabel: fmtMoney(-riskDollars),
      targetDollars,
      riskDollars,
      dollarsPerPricePoint: row.dollarsPerPricePoint * scale
    };
  });
}

type CustomScaleRangeSeed = {
  riskCeiling?: unknown;
  riskFloor?: unknown;
  targetCeiling?: unknown;
  targetFloor?: unknown;
};

type CustomScaleRange = {
  riskCeiling: number;
  riskFloor: number;
  targetCeiling: number;
  targetFloor: number;
};

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function parseCustomScaleRange(range: CustomScaleRangeSeed | undefined): CustomScaleRange | null {
  if (!range) return null;
  const targetFloor = positiveNumber(range.targetFloor);
  const targetCeiling = positiveNumber(range.targetCeiling);
  const riskFloor = positiveNumber(range.riskFloor);
  const riskCeiling = positiveNumber(range.riskCeiling);

  if (!targetFloor || !targetCeiling || !riskFloor || !riskCeiling) return null;
  if (targetFloor > targetCeiling || riskFloor > riskCeiling) return null;
  return { riskCeiling, riskFloor, targetCeiling, targetFloor };
}

function rowCustomRangeScale(row: TradeHistoryRow, range: CustomScaleRange): number {
  const baseTarget = Math.abs(row.targetDollars);
  const baseRisk = Math.abs(row.riskDollars);
  if (!(baseTarget > 0) || !(baseRisk > 0)) return 1;

  // The largest ceiling-safe scale also satisfies the floors whenever this trade's TP/SL ratio allows it.
  const scale = Math.min(range.targetCeiling / baseTarget, range.riskCeiling / baseRisk);
  return Number.isFinite(scale) && scale > 0 ? Number(scale.toFixed(6)) : 1;
}
