"use client";

import { useId, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  strategyContractScale,
  type StrategyEditOption,
  type StrategyEditSeedMap,
  useStrategyEdits
} from "@/components/strategies/strategy-edits-store";
import { LocalDateTimeStack } from "@/components/ui/local-date-time";

type BasketTrade = {
  key: string;
  entryTime: string;
  exitTime: string;
  barsHeld: number;
  basePnlDollars: number;
  rMultiple: number;
};

type DailyCurvePoint = {
  dayKey: string;
  pnl: number;
  equity: number;
  drawdown: number;
};

type DollarAggregate = {
  avgLossDollars: number;
  trades: number;
  avgWinDollars: number;
  consistencyScorePct: number | null;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  rewardRiskRatio: number;
  sharpeRatio: number;
  sortinoRatio: number;
  avgDurationMs: number;
  avgWinDurationMs: number;
  avgLossDurationMs: number;
  medianDurationMs: number;
  medianWinDurationMs: number;
  medianLossDurationMs: number;
  avgBarsHeld: number;
  longestDurationMs: number;
  maxDailyDrawdownDollars: number;
  avgDailyDollars: number;
  bestDayDollars: number;
  worstDayDollars: number;
  activeDays: number;
  winningDays: number;
  losingDays: number;
  dailyCurve: DailyCurvePoint[];
  totalDollars: number;
  avgDollars: number;
};

type SelectedStrategyStatsProps = {
  dataEndAt?: string;
  strategies: StrategyEditOption[];
  trades: BasketTrade[];
  persistedStrategyEdits?: StrategyEditSeedMap;
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

function latestEndDate(dataEndAt: string | undefined, selectedEnd: number | undefined): number | undefined {
  const dataEnd = dataEndAt ? Date.parse(dataEndAt) : Number.NaN;
  const candidates = [dataEnd, selectedEnd ?? Number.NaN].filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(...candidates) : undefined;
}

function statTone(value: number, higherIsGood = true): string {
  if (value === 0) return "tone-neutral";
  const good = higherIsGood ? value > 0 : value < 0;
  return good ? "tone-up" : "tone-down";
}

function ratioTone(value: number, threshold: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "tone-up" : "tone-neutral";
  if (value >= threshold) return "tone-up";
  if (value > 0) return "tone-neutral";
  return "tone-down";
}

function consistencyTone(value: number | null): string {
  if (value == null) return "tone-neutral";
  if (value >= 60) return "tone-up";
  if (value >= 50) return "tone-neutral";
  return "tone-down";
}

function fmtRiskReward(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "1:inf" : "--";
  return value > 0 ? `1:${fmtNumber(value)}` : "--";
}

function fmtDurationMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const totalMinutes = Math.max(1, Math.round(value / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDayKeyLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return dayKey;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

function localTradeDayKey(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return dateKey;
  date.setDate(date.getDate() + days);
  return localTradeDayKey(date.toISOString());
}

function dailyCurvePoints(dailyPnl: Map<string, number>): DailyCurvePoint[] {
  const keys = [...dailyPnl.keys()].sort((left, right) => left.localeCompare(right));
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) return [];

  const points: DailyCurvePoint[] = [];
  let equity = 0;
  let peak = 0;
  for (let day = first; day <= last; day = addDays(day, 1)) {
    const pnl = dailyPnl.get(day) ?? 0;
    equity += pnl;
    peak = Math.max(peak, equity);
    points.push({
      dayKey: day,
      pnl,
      equity,
      drawdown: peak - equity
    });
    if (day === last) break;
  }
  return points;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sampleStdDev(values: number[], average: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function downsideDeviation(values: number[]): number {
  if (!values.length) return 0;
  const downsideVariance = values.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, downsideVariance));
}

function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

function annualizedRatio(average: number, deviation: number, periodsPerYear: number): number {
  if (deviation === 0) return average > 0 ? Infinity : 0;
  return (average / deviation) * Math.sqrt(periodsPerYear);
}

function tradeDurationMs(trade: BasketTrade): number {
  const entry = Date.parse(trade.entryTime);
  const exit = Date.parse(trade.exitTime);
  if (Number.isFinite(entry) && Number.isFinite(exit) && exit > entry) return exit - entry;
  return Math.max(0, trade.barsHeld) * 15 * 60_000;
}

function aggregateDollars(trades: BasketTrade[], pnlForTrade: (trade: BasketTrade) => number): DollarAggregate {
  let grossWins = 0;
  let grossLosses = 0;
  let totalDollars = 0;
  let winDollars = 0;
  let lossDollars = 0;
  let wins = 0;
  let losses = 0;
  const dailyPnl = new Map<string, number>();
  const durationsMs: number[] = [];
  const winDurationsMs: number[] = [];
  const lossDurationsMs: number[] = [];
  const barsHeld: number[] = [];

  for (const trade of trades) {
    const pnl = pnlForTrade(trade);
    const result = trade.rMultiple;
    const durationMs = tradeDurationMs(trade);
    totalDollars += pnl;
    if (durationMs > 0) durationsMs.push(durationMs);
    if (Number.isFinite(trade.barsHeld) && trade.barsHeld > 0) barsHeld.push(trade.barsHeld);
    const dayKey = localTradeDayKey(trade.exitTime);
    dailyPnl.set(dayKey, (dailyPnl.get(dayKey) ?? 0) + pnl);

    if (result > 0) {
      wins += 1;
      grossWins += result;
      winDollars += pnl;
      if (durationMs > 0) winDurationsMs.push(durationMs);
    } else if (result < 0) {
      losses += 1;
      grossLosses += Math.abs(result);
      lossDollars += pnl;
      if (durationMs > 0) lossDurationsMs.push(durationMs);
    }
  }

  const dailyCurve = dailyCurvePoints(dailyPnl);
  const dailyValues = dailyCurve.map((point) => point.pnl);
  const averageDailyPnl = mean(dailyValues);
  const avgWinDollars = wins ? winDollars / wins : 0;
  const avgLossDollars = losses ? lossDollars / losses : 0;
  const largestWinningDay = Math.max(0, ...dailyPnl.values());
  const consistencyRatio = totalDollars > 0 && largestWinningDay > 0 ? largestWinningDay / totalDollars : null;
  const activeDailyValues = [...dailyPnl.values()];

  return {
    avgLossDollars,
    avgWinDollars,
    consistencyScorePct: consistencyRatio == null ? null : Math.max(0, Math.min(100, (1 - consistencyRatio) * 100)),
    trades: trades.length,
    wins,
    losses,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    profitFactor: grossLosses ? grossWins / grossLosses : grossWins ? Infinity : 0,
    rewardRiskRatio: avgLossDollars < 0 ? avgWinDollars / Math.abs(avgLossDollars) : avgWinDollars > 0 ? Infinity : 0,
    sharpeRatio: annualizedRatio(averageDailyPnl, sampleStdDev(dailyValues, averageDailyPnl), 252),
    sortinoRatio: annualizedRatio(averageDailyPnl, downsideDeviation(dailyValues), 252),
    avgDurationMs: mean(durationsMs),
    avgWinDurationMs: mean(winDurationsMs),
    avgLossDurationMs: mean(lossDurationsMs),
    medianDurationMs: median(durationsMs),
    medianWinDurationMs: median(winDurationsMs),
    medianLossDurationMs: median(lossDurationsMs),
    avgBarsHeld: mean(barsHeld),
    longestDurationMs: Math.max(0, ...durationsMs),
    maxDailyDrawdownDollars: Math.max(0, ...dailyCurve.map((point) => point.drawdown)),
    avgDailyDollars: averageDailyPnl,
    bestDayDollars: Math.max(0, ...activeDailyValues),
    worstDayDollars: Math.min(0, ...activeDailyValues),
    activeDays: dailyPnl.size,
    winningDays: activeDailyValues.filter((value) => value > 0).length,
    losingDays: activeDailyValues.filter((value) => value < 0).length,
    dailyCurve,
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

function DailyCurveSparkline({ points }: { points: DailyCurvePoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const width = 720;
  const height = 164;
  const padLeft = 54;
  const padRight = 22;
  const padTop = 18;
  const padBottom = 30;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const plot = useMemo(() => {
    if (points.length < 2) return null;
    const equities = points.map((point) => point.equity);
    const dailyValues = points.map((point) => point.pnl);
    const maxDrawdown = Math.max(0, ...points.map((point) => point.drawdown));
    let runningPeak = 0;
    const peakValues = points.map((point) => {
      runningPeak = Math.max(runningPeak, point.equity);
      return runningPeak;
    });
    const minEquity = Math.min(0, ...equities);
    const maxEquity = Math.max(0, ...equities);
    const span = Math.max(1, maxEquity - minEquity);
    const xFor = (index: number) => padLeft + (index / Math.max(1, points.length - 1)) * plotWidth;
    const yFor = (value: number) => padTop + ((maxEquity - value) / span) * plotHeight;
    const zeroY = yFor(0);
    const linePath = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(2)} ${yFor(point.equity).toFixed(2)}`)
      .join(" ");
    const highWaterPath = peakValues
      .map((peak, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(2)} ${yFor(peak).toFixed(2)}`)
      .join(" ");
    const areaPath = `${linePath} L ${xFor(points.length - 1).toFixed(2)} ${zeroY.toFixed(2)} L ${xFor(0).toFixed(2)} ${zeroY.toFixed(2)} Z`;
    const yTickValues = [maxEquity, maxEquity - span * 0.25, maxEquity - span * 0.5, maxEquity - span * 0.75, minEquity];
    const uniqueYTicks = yTickValues.filter((value, index, list) => list.findIndex((candidate) => Math.abs(candidate - value) < 0.01) === index);
    const dailyMaxAbs = Math.max(1, ...dailyValues.map((value) => Math.abs(value)));
    const barWidth = clamp((plotWidth / points.length) * 0.55, 2, 11);
    const drawdownHeight = 22;
    const drawdownBase = height - 6;
    const peakIndex = equities.reduce((bestIndex, value, index) => (value > (equities[bestIndex] ?? -Infinity) ? index : bestIndex), 0);
    const maxDrawdownIndex = points.reduce(
      (bestIndex, point, index) => (point.drawdown > (points[bestIndex]?.drawdown ?? -Infinity) ? index : bestIndex),
      0
    );

    return {
      areaPath,
      barWidth,
      dailyMaxAbs,
      drawdownBase,
      drawdownHeight,
      highWaterPath,
      linePath,
      maxDrawdown,
      maxEquity,
      maxDrawdownIndex,
      minEquity,
      peakIndex,
      peakValues,
      xFor,
      yFor,
      yTicks: uniqueYTicks,
      zeroY
    };
  }, [padLeft, plotHeight, plotWidth, points]);

  if (points.length < 2) {
    return <div className="dailyCurveEmpty">Daily curve needs at least two trading days.</div>;
  }

  if (!plot) return null;

  const last = points[points.length - 1]!;
  const tone = last.equity >= 0 ? "up" : "down";
  const activeIndex = hoverIndex ?? points.length - 1;
  const activePoint = points[activeIndex] ?? last;
  const activeX = plot.xFor(activeIndex);
  const activeY = plot.yFor(activePoint.equity);
  const tooltipSide = activeX > width * 0.68 ? "left" : "right";
  const tooltipTop = clamp(activeY, 34, height - 38);
  const peakPoint = points[plot.peakIndex] ?? last;
  const drawdownPoint = points[plot.maxDrawdownIndex] ?? last;
  const activePeak = plot.peakValues[activeIndex] ?? 0;

  function handleMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const svgX = ratio * width;
    const index = Math.round(((svgX - padLeft) / plotWidth) * Math.max(1, points.length - 1));
    setHoverIndex(clamp(index, 0, points.length - 1));
  }

  return (
    <div
      className={`dailyCurveSparkline ${tone}${hoverIndex == null ? "" : " isHovering"}`}
      onClick={(event) => event.stopPropagation()}
      onMouseLeave={() => setHoverIndex(null)}
      onMouseMove={handleMouseMove}
    >
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cumulative daily profit and loss curve">
        <defs>
          <linearGradient id={`${chartId}-area`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" className="dailyCurveAreaStopStart" />
            <stop offset="100%" className="dailyCurveAreaStopEnd" />
          </linearGradient>
          <linearGradient id={`${chartId}-dd`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(248,113,113,0.42)" />
            <stop offset="100%" stopColor="rgba(248,113,113,0.02)" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={width} height={height} className="dailyCurvePanelBg" />
        {plot.yTicks.map((value) => {
          const y = plot.yFor(value);
          return (
            <g key={`y-${value.toFixed(2)}`}>
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} className="dailyCurveGridLine" />
              <text x={padLeft - 10} y={y + 4} className="dailyCurveAxisLabel" textAnchor="end">
                {fmtMoney(value)}
              </text>
            </g>
          );
        })}
        <line x1={padLeft} x2={width - padRight} y1={plot.zeroY} y2={plot.zeroY} className="dailyCurveZeroLine" />
        <text x={width - padRight} y={plot.zeroY - 6} className="dailyCurveZeroLabel" textAnchor="end">
          break even
        </text>

        {points.map((point, index) => {
          const x = plot.xFor(index);
          const half = plot.barWidth / 2;
          const positive = point.pnl >= 0;
          const barHeight = Math.max(2, (Math.abs(point.pnl) / plot.dailyMaxAbs) * 30);
          const y = positive ? plot.zeroY - barHeight : plot.zeroY;
          const drawdownHeight = plot.maxDrawdown > 0 ? (point.drawdown / plot.maxDrawdown) * plot.drawdownHeight : 0;
          return (
            <g key={point.dayKey}>
              {drawdownHeight > 0.8 ? (
                <rect
                  x={x - half}
                  y={plot.drawdownBase - drawdownHeight}
                  width={plot.barWidth}
                  height={drawdownHeight}
                  className="dailyCurveDrawdownBar"
                />
              ) : null}
              <rect
                x={x - half}
                y={y}
                width={plot.barWidth}
                height={barHeight}
                className={positive ? "dailyCurveDailyBar up" : "dailyCurveDailyBar down"}
              />
            </g>
          );
        })}

        <path d={plot.areaPath} className="dailyCurveArea" fill={`url(#${chartId}-area)`} />
        <path d={plot.highWaterPath} className="dailyCurveHighWaterLine" />
        <path d={plot.linePath} className="dailyCurveLine" pathLength={1} />
        <g className="dailyCurvePeakMarker">
          <circle cx={plot.xFor(plot.peakIndex)} cy={plot.yFor(peakPoint.equity)} r="3.5" />
          <text x={plot.xFor(plot.peakIndex) + 7} y={plot.yFor(peakPoint.equity) - 7}>
            Peak {fmtMoney(peakPoint.equity, true)}
          </text>
        </g>
        {plot.maxDrawdown > 0 ? (
          <g className="dailyCurveDrawdownMarker">
            <circle cx={plot.xFor(plot.maxDrawdownIndex)} cy={plot.yFor(drawdownPoint.equity)} r="3.5" />
            <text x={plot.xFor(plot.maxDrawdownIndex) + 7} y={plot.yFor(drawdownPoint.equity) + 15}>
              Max DD {fmtMoney(-plot.maxDrawdown)}
            </text>
          </g>
        ) : null}
        <g className="dailyCurveEndMarker">
          <circle cx={plot.xFor(points.length - 1)} cy={plot.yFor(last.equity)} r="4" className="dailyCurveEndDot" />
          <text x={plot.xFor(points.length - 1) - 8} y={plot.yFor(last.equity) - 10} textAnchor="end">
            {fmtMoney(last.equity, true)}
          </text>
        </g>
        <g className="dailyCurveDateRail">
          <text x={padLeft} y={height - 10}>{formatDayKeyLabel(points[0]!.dayKey)}</text>
          <text x={width - padRight} y={height - 10} textAnchor="end">{formatDayKeyLabel(last.dayKey)}</text>
        </g>

        {hoverIndex == null ? null : (
          <g className="dailyCurveCrosshair">
            <line x1={activeX} x2={activeX} y1={padTop} y2={height - padBottom} />
            <line x1={padLeft} x2={width - padRight} y1={activeY} y2={activeY} />
            <circle cx={activeX} cy={activeY} r="5" />
          </g>
        )}
      </svg>
      {hoverIndex == null ? null : (
        <div
          className={`dailyCurveTooltip ${tooltipSide}`}
          style={{ left: `${(activeX / width) * 100}%`, top: `${(tooltipTop / height) * 100}%` }}
        >
          <strong>{formatDayKeyLabel(activePoint.dayKey)}</strong>
          <span className={activePoint.equity >= 0 ? "up" : "down"}>Equity {fmtMoney(activePoint.equity, true)}</span>
          <span className={activePoint.pnl >= 0 ? "up" : "down"}>Day {fmtMoney(activePoint.pnl, true)}</span>
          <span>High water {fmtMoney(activePeak, true)}</span>
          <span>Drawdown {fmtMoney(-activePoint.drawdown)}</span>
        </div>
      )}
      <div className="dailyCurveLegend" aria-hidden="true">
        <span className="equity">Equity</span>
        <span className="daily">Daily P&L</span>
        <span className="drawdown">Drawdown</span>
      </div>
    </div>
  );
}

export default function SelectedStrategyStats({ dataEndAt, strategies, trades, persistedStrategyEdits }: SelectedStrategyStatsProps) {
  const [expanded, setExpanded] = useState(false);
  const edits = useStrategyEdits(strategies, persistedStrategyEdits);
  const strategyByKey = new Map(strategies.map((strategy) => [strategy.key, strategy]));
  const selectedCadence = tradeCadence(trades);
  const selectedDollarAggregate = aggregateDollars(trades, (trade) => {
    const strategy = strategyByKey.get(trade.key);
    return trade.basePnlDollars * (strategy ? strategyContractScale(strategy, edits) : 1);
  });
  const toggleExpanded = () => setExpanded((current) => !current);

  return (
    <div
      className={`selectedStatsSurface${expanded ? " is-expanded" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse selected strategy stats" : "Expand selected strategy stats"}
      onClick={toggleExpanded}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleExpanded();
        }
      }}
    >
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
      {expanded ? (
        <>
      <div className={`backtest-stat-card dailyCurveStatCard ${statTone(selectedDollarAggregate.totalDollars)}`}>
        <div className="dailyCurveStatHead">
          <span>Daily curve</span>
          <strong>{selectedDollarAggregate.trades ? fmtMoney(selectedDollarAggregate.totalDollars, true) : "--"}</strong>
        </div>
        <DailyCurveSparkline points={selectedDollarAggregate.dailyCurve} />
        <div className="dailyCurveMeta">
          <span>{fmtNumber(selectedDollarAggregate.activeDays)} active days</span>
          <span>{fmtNumber(selectedDollarAggregate.winningDays)} winning days</span>
          <span>{fmtNumber(selectedDollarAggregate.losingDays)} losing days</span>
          <span>{selectedDollarAggregate.trades ? fmtMoney(selectedDollarAggregate.avgDailyDollars, true) : "--"} avg day</span>
        </div>
      </div>
      <div className={`backtest-stat-card ${statTone(selectedDollarAggregate.avgDailyDollars)}`}>
        <span>Average day</span>
        <strong>{selectedDollarAggregate.trades ? fmtMoney(selectedDollarAggregate.avgDailyDollars, true) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${statTone(selectedDollarAggregate.bestDayDollars)}`}>
        <span>Best day</span>
        <strong>{selectedDollarAggregate.trades ? fmtMoney(selectedDollarAggregate.bestDayDollars, true) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${statTone(selectedDollarAggregate.worstDayDollars)}`}>
        <span>Worst day</span>
        <strong>{selectedDollarAggregate.trades ? fmtMoney(selectedDollarAggregate.worstDayDollars, true) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${statTone(-selectedDollarAggregate.maxDailyDrawdownDollars)}`}>
        <span>Max daily DD</span>
        <strong>{selectedDollarAggregate.trades ? fmtMoney(-selectedDollarAggregate.maxDailyDrawdownDollars) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Winning days</span>
        <strong>{selectedDollarAggregate.trades ? fmtNumber(selectedDollarAggregate.winningDays) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Losing days</span>
        <strong>{selectedDollarAggregate.trades ? fmtNumber(selectedDollarAggregate.losingDays) : "--"}</strong>
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
      <div className="backtest-stat-card tone-neutral date-stat-card">
        <span>Start date</span>
        <strong><LocalDateTimeStack value={selectedCadence.start} /></strong>
      </div>
      <div className="backtest-stat-card tone-neutral date-stat-card">
        <span>End date</span>
        <strong><LocalDateTimeStack value={latestEndDate(dataEndAt, selectedCadence.end)} /></strong>
      </div>
      <div className={`backtest-stat-card ${ratioTone(selectedDollarAggregate.sharpeRatio, 1)}`}>
        <span>Daily Sharpe</span>
        <strong>{selectedDollarAggregate.trades ? fmtNumber(selectedDollarAggregate.sharpeRatio) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${ratioTone(selectedDollarAggregate.sortinoRatio, 1)}`}>
        <span>Daily Sortino</span>
        <strong>{selectedDollarAggregate.trades ? fmtNumber(selectedDollarAggregate.sortinoRatio) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${statTone(selectedDollarAggregate.avgWinDollars)}`}>
        <span>Average win</span>
        <strong>{selectedDollarAggregate.wins ? fmtMoney(selectedDollarAggregate.avgWinDollars, true) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${statTone(selectedDollarAggregate.avgLossDollars)}`}>
        <span>Average loss</span>
        <strong>{selectedDollarAggregate.losses ? fmtMoney(selectedDollarAggregate.avgLossDollars, true) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${ratioTone(selectedDollarAggregate.rewardRiskRatio, 2)}`}>
        <span>Risk / reward</span>
        <strong>{selectedDollarAggregate.trades ? fmtRiskReward(selectedDollarAggregate.rewardRiskRatio) : "--"}</strong>
      </div>
      <div className={`backtest-stat-card ${consistencyTone(selectedDollarAggregate.consistencyScorePct)}`}>
        <span>Consistency</span>
        <strong>{selectedDollarAggregate.consistencyScorePct == null ? "--" : fmtPct(selectedDollarAggregate.consistencyScorePct)}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Avg duration</span>
        <strong>{selectedDollarAggregate.trades ? fmtDurationMs(selectedDollarAggregate.avgDurationMs) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Avg win duration</span>
        <strong>{selectedDollarAggregate.wins ? fmtDurationMs(selectedDollarAggregate.avgWinDurationMs) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Avg loss duration</span>
        <strong>{selectedDollarAggregate.losses ? fmtDurationMs(selectedDollarAggregate.avgLossDurationMs) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Median duration</span>
        <strong>{selectedDollarAggregate.trades ? fmtDurationMs(selectedDollarAggregate.medianDurationMs) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Median win duration</span>
        <strong>{selectedDollarAggregate.wins ? fmtDurationMs(selectedDollarAggregate.medianWinDurationMs) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Median loss duration</span>
        <strong>{selectedDollarAggregate.losses ? fmtDurationMs(selectedDollarAggregate.medianLossDurationMs) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Avg bars held</span>
        <strong>{selectedDollarAggregate.trades ? fmtNumber(selectedDollarAggregate.avgBarsHeld) : "--"}</strong>
      </div>
      <div className="backtest-stat-card tone-neutral">
        <span>Longest trade</span>
        <strong>{selectedDollarAggregate.trades ? fmtDurationMs(selectedDollarAggregate.longestDurationMs) : "--"}</strong>
      </div>
        </>
      ) : null}
      </div>
      <div className="selectedStatsToggleHint" aria-hidden="true">
        <span>{expanded ? "Hide details" : "More stats"}</span>
      </div>
    </div>
  );
}
