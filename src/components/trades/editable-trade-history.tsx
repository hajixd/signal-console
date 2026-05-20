"use client";

import { useMemo } from "react";
import {
  strategyContractScale,
  type StrategyEditOption,
  type StrategyEditSeedMap,
  useStrategyEdits
} from "@/components/strategies/strategy-edits-store";
import TradeHistory, { TradeHistoryCalendar, type TradeHistoryRow } from "@/components/trades/trade-history";
import { instrumentSizeLabel } from "@/lib/instruments";

type EditableTradeHistoryProps = {
  rows: TradeHistoryRow[];
  strategies: StrategyEditOption[];
  persistedStrategyEdits?: StrategyEditSeedMap;
  view?: "calendar" | "list";
};

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

export default function EditableTradeHistory({ rows, strategies, persistedStrategyEdits, view = "list" }: EditableTradeHistoryProps) {
  const edits = useStrategyEdits(strategies, persistedStrategyEdits);
  const strategyByKey = useMemo(() => new Map(strategies.map((strategy) => [strategy.key, strategy])), [strategies]);

  const adjustedRows = useMemo(
    () =>
      rows.map((row) => {
        const strategy = strategyByKey.get(row.strategyKey);
        if (row.lockedSize) return row;
        if (!strategy) return row;

        const scale = strategyContractScale(strategy, edits);
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
      }),
    [edits, rows, strategyByKey]
  );

  return view === "calendar" ? <TradeHistoryCalendar rows={adjustedRows} /> : <TradeHistory rows={adjustedRows} />;
}
