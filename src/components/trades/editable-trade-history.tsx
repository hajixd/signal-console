"use client";

import { useMemo } from "react";
import {
  type StrategyEditOption,
  type StrategyEditSeedMap,
  useStrategyEdits
} from "@/components/strategies/strategy-edits-store";
import { adjustTradeHistoryRows } from "@/components/trades/adjust-trade-history-rows";
import TradeHistory, { TradeHistoryCalendar, type TradeHistoryRow } from "@/components/trades/trade-history";

type EditableTradeHistoryProps = {
  customScaleRange?: CustomScaleRangeSeed;
  rows: TradeHistoryRow[];
  strategies: StrategyEditOption[];
  persistedStrategyEdits?: StrategyEditSeedMap;
  view?: "calendar" | "list";
};

type CustomScaleRangeSeed = {
  riskCeiling?: unknown;
  riskFloor?: unknown;
  targetCeiling?: unknown;
  targetFloor?: unknown;
};

export default function EditableTradeHistory({ customScaleRange, rows, strategies, persistedStrategyEdits, view = "list" }: EditableTradeHistoryProps) {
  const edits = useStrategyEdits(strategies, persistedStrategyEdits);
  const adjustedRows = useMemo(() => adjustTradeHistoryRows(rows, strategies, edits, customScaleRange), [customScaleRange, edits, rows, strategies]);

  return view === "calendar" ? <TradeHistoryCalendar rows={adjustedRows} /> : <TradeHistory rows={adjustedRows} />;
}
