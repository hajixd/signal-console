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
  backtestBehindMarketData: boolean;
  historySourceLabel: string;
  latestHistoryTradeAt?: string;
  persistedStrategyEdits?: StrategyEditSeedMap;
  rows: TradeHistoryRow[];
  strategies: StrategyEditOption[];
};

type HistoryViewMode = "list" | "calendar";

export default function BacktestHistoryPanel({
  backtestBehindMarketData,
  historySourceLabel,
  latestHistoryTradeAt,
  persistedStrategyEdits,
  rows,
  strategies
}: BacktestHistoryPanelProps) {
  const [view, setView] = useState<HistoryViewMode>("list");

  return (
    <>
      <div className="backtest-card-head historyPanelHead">
        <div>
          <div className="historyTitleLine">
            <h2>Backtest History</h2>
            <div className="historyViewSwitch" role="tablist" aria-label="Backtest history view">
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
            Stored backtest trades plus closed live alerts for the active market. Latest history trade:{" "}
            <LocalDateTime value={latestHistoryTradeAt} fallback="unknown" />.
          </p>
        </div>
        <div className="historyHeadActions">
          <span className={`count-pill${backtestBehindMarketData ? " warning" : ""}`}>{historySourceLabel}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <strong>No backtest trades match</strong>
          <span>No stored backtest trades or closed live alerts are available for this market.</span>
        </div>
      ) : (
        <EditableTradeHistory rows={rows} strategies={strategies} persistedStrategyEdits={persistedStrategyEdits} view={view} />
      )}
    </>
  );
}
