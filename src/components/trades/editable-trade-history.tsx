"use client";

import { useMemo } from "react";
import {
  effectiveStrategyEdit,
  formatSizeLabel,
  strategyContractScale,
  type StrategyEditOption,
  useStrategyEdits
} from "@/components/strategies/strategy-edits-store";
import TradeHistory, { type TradeHistoryRow } from "@/components/trades/trade-history";

type EditableTradeHistoryProps = {
  rows: TradeHistoryRow[];
  strategies: StrategyEditOption[];
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

export default function EditableTradeHistory({ rows, strategies }: EditableTradeHistoryProps) {
  const edits = useStrategyEdits(strategies);
  const strategyByKey = useMemo(() => new Map(strategies.map((strategy) => [strategy.key, strategy])), [strategies]);

  const adjustedRows = useMemo(
    () =>
      rows.map((row) => {
        const strategy = strategyByKey.get(row.strategyKey);
        if (!strategy) return row;

        const scale = strategyContractScale(strategy, edits);
        const effective = effectiveStrategyEdit(strategy, edits);
        const pnlDollars = row.pnlDollars * scale;
        const targetDollars = row.targetDollars * scale;
        const riskDollars = row.riskDollars * scale;

        return {
          ...row,
          rowClassName: resultRowClass(pnlDollars),
          pnlClassName: resultClass(pnlDollars),
          pnlDollars,
          pnlLabel: fmtMoney(pnlDollars, true),
          sizeLabel: formatSizeLabel(effective.contracts, effective.sizeName),
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

  return <TradeHistory rows={adjustedRows} />;
}
