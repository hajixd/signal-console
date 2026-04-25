"use client";

import { strategyContractScale, type StrategyEditOption, useStrategyEdits } from "@/components/strategies/strategy-edits-store";

type BasketTrade = {
  key: string;
  entryTime: string;
  basePnlDollars: number;
  rMultiple: number;
};

type DollarAggregate = {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  totalDollars: number;
  avgDollars: number;
};

type SelectedStrategyStatsProps = {
  strategies: StrategyEditOption[];
  trades: BasketTrade[];
};

function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return "inf";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function fmtPct(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value)}%`;
}

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

function fmtDate(value: number | undefined): string {
  if (!value) return "--";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function statTone(value: number, higherIsGood = true): string {
  if (value === 0) return "tone-neutral";
  const good = higherIsGood ? value > 0 : value < 0;
  return good ? "tone-up" : "tone-down";
}

function aggregateDollars(trades: BasketTrade[], pnlForTrade: (trade: BasketTrade) => number): DollarAggregate {
  let grossWins = 0;
  let grossLosses = 0;
  let totalDollars = 0;
  let wins = 0;
  let losses = 0;

  for (const trade of trades) {
    const pnl = pnlForTrade(trade);
    const result = trade.rMultiple;
    totalDollars += pnl;
    if (result > 0) {
      wins += 1;
      grossWins += result;
    } else if (result < 0) {
      losses += 1;
      grossLosses += Math.abs(result);
    }
  }

  return {
    trades: trades.length,
    wins,
    losses,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    profitFactor: grossLosses ? grossWins / grossLosses : grossWins ? Infinity : 0,
    totalDollars,
    avgDollars: trades.length ? totalDollars / trades.length : 0
  };
}

function tradeCadence(trades: BasketTrade[]) {
  const times = trades.map((trade) => Date.parse(trade.entryTime)).filter((time) => Number.isFinite(time));
  if (!times.length) {
    return {
      start: undefined,
      end: undefined,
      perDay: 0,
      perWeek: 0,
      perMonth: 0,
      perYear: 0
    };
  }

  const start = Math.min(...times);
  const end = Math.max(...times);
  const days = Math.max((end - start) / 86_400_000, 1);
  return {
    start,
    end,
    perDay: trades.length / days,
    perWeek: trades.length / (days / 7),
    perMonth: trades.length / (days / 30.4375),
    perYear: trades.length / (days / 365.25)
  };
}

export default function SelectedStrategyStats({ strategies, trades }: SelectedStrategyStatsProps) {
  const edits = useStrategyEdits(strategies);
  const strategyByKey = new Map(strategies.map((strategy) => [strategy.key, strategy]));
  const selectedDollarAggregate = aggregateDollars(trades, (trade) => {
    const strategy = strategyByKey.get(trade.key);
    return trade.basePnlDollars * (strategy ? strategyContractScale(strategy, edits) : 1);
  });
  const selectedCadence = tradeCadence(trades);

  return (
    <div className="backtest-stats-grid">
      <div className={`backtest-stat-card ${selectedDollarAggregate.profitFactor >= 1 ? "tone-up" : "tone-down"}`}>
        <span>PF</span>
        <strong>{selectedDollarAggregate.trades ? fmtNumber(selectedDollarAggregate.profitFactor) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${selectedDollarAggregate.winRatePct >= 50 ? "tone-up" : "tone-neutral"}`}>
        <span>Win rate</span>
        <strong>{selectedDollarAggregate.trades ? fmtPct(selectedDollarAggregate.winRatePct) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${statTone(selectedDollarAggregate.totalDollars)}`}>
        <span>Total P&L</span>
        <strong>{selectedDollarAggregate.trades ? fmtMoney(selectedDollarAggregate.totalDollars, true) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${statTone(selectedDollarAggregate.avgDollars)}`}>
        <span>Avg trade</span>
        <strong>{selectedDollarAggregate.trades ? fmtMoney(selectedDollarAggregate.avgDollars, true) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Wins</span>
        <strong>{fmtNumber(selectedDollarAggregate.wins)}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Losses</span>
        <strong>{fmtNumber(selectedDollarAggregate.losses)}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Trades / day</span>
        <strong>{selectedDollarAggregate.trades ? fmtNumber(selectedCadence.perDay) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Trades / week</span>
        <strong>{selectedDollarAggregate.trades ? fmtNumber(selectedCadence.perWeek) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Trades / month</span>
        <strong>{selectedDollarAggregate.trades ? fmtNumber(selectedCadence.perMonth) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Trades / year</span>
        <strong>{selectedDollarAggregate.trades ? fmtNumber(selectedCadence.perYear) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Start date</span>
        <strong>{fmtDate(selectedCadence.start)}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>End date</span>
        <strong>{fmtDate(selectedCadence.end)}</strong>
      </div>
    </div>
  );
}
