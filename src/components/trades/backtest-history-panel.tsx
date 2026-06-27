"use client";

import { useState } from "react";
import {
  type StrategyEditOption,
  type StrategyEditSeedMap
} from "@/components/strategies/strategy-edits-store";
import EditableTradeHistory from "@/components/trades/editable-trade-history";
import { type TradeHistoryRow } from "@/components/trades/trade-history";
import LocalDateTime from "@/components/ui/local-date-time";

type BacktestHistoryPanelProps = {
  backtestBehindMarketData?: boolean;
  customScaleRange?: CustomScaleRangeSeed;
  descriptionPrefix?: string;
  emptyMessage?: string;
  emptyTitle?: string;
  historySourceLabel: string;
  latestHistoryTradeLabel?: string;
  latestHistoryTradeAt?: string;
  persistedStrategyEdits?: StrategyEditSeedMap;
  rows: TradeHistoryRow[];
  strategies: StrategyEditOption[];
  title?: string;
  viewAriaLabel?: string;
};

type HistoryViewMode = "list" | "calendar";
type CustomScaleRangeSeed = {
  riskCeiling?: unknown;
  riskFloor?: unknown;
  targetCeiling?: unknown;
  targetFloor?: unknown;
};

export default function BacktestHistoryPanel({
  backtestBehindMarketData = false,
  customScaleRange,
  descriptionPrefix = "Stored historical trades for all active-market strategies.",
  emptyMessage = "No stored backtest trades are available for this market yet.",
  emptyTitle = "No backtest trades match",
  historySourceLabel,
  latestHistoryTradeLabel = "Latest history trade",
  latestHistoryTradeAt,
  persistedStrategyEdits,
  rows,
  strategies,
  title = "Backtest History",
  viewAriaLabel
}: BacktestHistoryPanelProps) {
  const [view, setView] = useState<HistoryViewMode>("list");

  return (
    <>
      <div className="backtest-card-head historyPanelHead">
        <div>
          <div className="historyTitleLine">
            <h2>{title}</h2>
            <div className="historyViewSwitch" role="tablist" aria-label={viewAriaLabel ?? `${title} view`}>
              {(["list", "calendar"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={view === mode ? "active" : ""}
                  role="tab"
                  aria-selected={view === mode}
                  onClick={() => setView(mode)}
                >
                  {mode === "list" ? "List" : "Calendar"}
                </button>
              ))}
            </div>
          </div>
          <p>
            {descriptionPrefix} {latestHistoryTradeLabel}:{" "}
            <LocalDateTime value={latestHistoryTradeAt} fallback="unknown" />.
          </p>
        </div>
        <div className="historyHeadActions">
          <span className={`count-pill${backtestBehindMarketData ? " warning" : ""}`}>{historySourceLabel}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <strong>{emptyTitle}</strong>
          <span>{emptyMessage}</span>
        </div>
      ) : (
        <EditableTradeHistory
          customScaleRange={customScaleRange}
          rows={rows}
          strategies={strategies}
          persistedStrategyEdits={persistedStrategyEdits}
          view={view}
        />
      )}
    </>
  );
}
