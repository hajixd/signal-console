"use client";

import { MouseEvent, useEffect, useState } from "react";
import {
  compactId,
  strategyEntryConditions,
  strategyExitConditions,
  strategyLimitOrderPlan,
  strategyStopLossPlan,
  strategyTakeProfitPlan,
  type ResearchStrategyLike
} from "@/components/research/research-strategy-detail";

export type ResearchBacktestMetrics = {
  averageLossR?: number;
  averageR?: number;
  averageWinR?: number;
  bestWinR?: number;
  expectancyR?: number;
  grossLossR?: number;
  grossWinR?: number;
  losses?: number;
  maxDrawdownR?: number;
  medianR?: number;
  profitFactor?: number;
  totalR?: number;
  trades?: number;
  winRatePct?: number;
  wins?: number;
  worstLossR?: number;
};

export type ResearchBacktestRow = ResearchStrategyLike & {
  asset_key: string;
  backtestedAt?: string;
  engine: string;
  exitReasons?: Record<string, number>;
  market: string;
  metrics?: ResearchBacktestMetrics;
  profit_factor: string;
  qualified: string;
  status: string;
  strategy_id: string;
  total_r: string;
  trades: string;
};

type ResearchBacktestTableProps = {
  density?: "default" | "split";
  empty: string;
  rows: ResearchBacktestRow[];
};

function formatNumber(value: number | undefined, digits = 0) {
  if (value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function formatMetric(value: string | number | undefined, digits = 2) {
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(digits) : value || "n/a";
}

function formatPct(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? "n/a" : `${value.toFixed(1)}%`;
}

function passLabel(row: ResearchBacktestRow) {
  return row.qualified === "True" ? "Finished" : "Needs more edge";
}

function closeFromBackdrop(setSelected: (value: ResearchBacktestRow | null) => void) {
  return (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) setSelected(null);
  };
}

function exitReasonText(row: ResearchBacktestRow) {
  const entries = Object.entries(row.exitReasons ?? {}).sort((left, right) => right[1] - left[1]);
  if (!entries.length) return "No exit reason breakdown was stored.";
  return entries.map(([reason, count]) => `${reason}: ${count}`).join(", ");
}

export default function ResearchBacktestTable({ density = "default", empty, rows }: ResearchBacktestTableProps) {
  const [selected, setSelected] = useState<ResearchBacktestRow | null>(null);

  useEffect(() => {
    if (!selected) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected]);

  if (!rows.length) {
    return (
      <div className="researchEmptyMini">
        <strong>{empty}</strong>
      </div>
    );
  }

  return (
    <>
      <div className={`terminal-table-wrap compact researchLaneTable${density === "split" ? " researchLaneTableSplit" : ""}`}>
        <table className="terminal-table researchTable">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Asset</th>
              <th>PF</th>
              <th>Trades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                className={`${row.qualified === "True" ? "up-row" : "neutral-row"} clickable`}
                key={row.strategy_id}
                onClick={() => setSelected(row)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelected(row);
                }}
              >
                <td className="main-cell" data-label="Strategy">
                  <span>{compactId(row.strategy_id)}</span>
                  <small>{row.engine}</small>
                </td>
                <td data-label="Asset">{row.asset_key}</td>
                <td data-label="PF">{formatMetric(row.metrics?.profitFactor ?? row.profit_factor, 2)}</td>
                <td data-label="Trades">{formatNumber(row.metrics?.trades ?? (Number(row.trades) || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="researchModalBackdrop" onMouseDown={closeFromBackdrop(setSelected)}>
          <section aria-modal="true" className="researchIdeaModal researchDetailModal" role="dialog">
            <div className="researchIdeaModalHead">
              <div>
                <span>Backtest result</span>
                <strong>{selected.title ?? selected.strategy_id}</strong>
              </div>
              <button aria-label="Close backtest details" onClick={() => setSelected(null)} type="button">
                X
              </button>
            </div>

            <div className="researchDetailStatGrid prominent">
              <div>
                <span>Profit Factor</span>
                <strong>{formatMetric(selected.metrics?.profitFactor ?? selected.profit_factor, 2)}</strong>
              </div>
              <div>
                <span>Win Rate</span>
                <strong>{formatPct(selected.metrics?.winRatePct)}</strong>
              </div>
              <div>
                <span>Total Trades</span>
                <strong>{formatNumber(selected.metrics?.trades ?? (Number(selected.trades) || 0))}</strong>
              </div>
              <div>
                <span>Total R</span>
                <strong>{formatMetric(selected.metrics?.totalR ?? selected.total_r, 2)}</strong>
              </div>
              <div>
                <span>Average Win</span>
                <strong>{formatMetric(selected.metrics?.averageWinR, 2)}R</strong>
              </div>
              <div>
                <span>Average Loss</span>
                <strong>{formatMetric(selected.metrics?.averageLossR, 2)}R</strong>
              </div>
              <div>
                <span>Expectancy</span>
                <strong>{formatMetric(selected.metrics?.expectancyR, 3)}R</strong>
              </div>
              <div>
                <span>Max Drawdown</span>
                <strong>{formatMetric(selected.metrics?.maxDrawdownR, 2)}R</strong>
              </div>
              <div>
                <span>Wins / Losses</span>
                <strong>{formatNumber(selected.metrics?.wins)} / {formatNumber(selected.metrics?.losses)}</strong>
              </div>
              <div>
                <span>Best / Worst</span>
                <strong>{formatMetric(selected.metrics?.bestWinR, 2)}R / {formatMetric(selected.metrics?.worstLossR, 2)}R</strong>
              </div>
              <div>
                <span>Median Trade</span>
                <strong>{formatMetric(selected.metrics?.medianR, 3)}R</strong>
              </div>
              <div>
                <span>Review</span>
                <strong>{passLabel(selected)}</strong>
              </div>
            </div>

            <div className="researchDetailSections">
              <section>
                <span>Entry Conditions</span>
                <p>{strategyEntryConditions(selected)}</p>
              </section>
              <section>
                <span>Exit Conditions</span>
                <p>{strategyExitConditions(selected)}</p>
              </section>
              <section>
                <span>How TP Is Determined</span>
                <p>{strategyTakeProfitPlan(selected)}</p>
              </section>
              <section>
                <span>How SL Is Determined</span>
                <p>{strategyStopLossPlan(selected)}</p>
              </section>
              <section>
                <span>Use Limit Order</span>
                <p>{strategyLimitOrderPlan(selected)}</p>
              </section>
              <section>
                <span>Exit Reason Mix</span>
                <p>{exitReasonText(selected)}</p>
              </section>
              {selected.hypothesis ? (
                <section className="wide">
                  <span>Overall Description</span>
                  <p>{selected.hypothesis}</p>
                </section>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
