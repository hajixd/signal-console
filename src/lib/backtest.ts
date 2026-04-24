import { readFile } from "node:fs/promises";
import path from "node:path";
import { strategyPhaseIsLive } from "@/core/strategies/registry";
import { recommendedSizeMultiplier } from "./instruments";
import { benchmarkMlModelName, strategyDisplayLabel } from "./strategy-names";
import {
  defaultTickSize,
  rowIdentity,
  STRATEGY_DATASETS,
  strategyKey,
  strategyLogicalKey,
  type CsvRow,
  type StrategyDataset,
  type StrategyKey
} from "./strategy-sources";

export type { StrategyKey } from "./strategy-sources";

export type BacktestStat = {
  key: StrategyKey;
  logicalKey: string;
  datasetId: string;
  datasetLabel: string;
  market?: string;
  symbol: string;
  phase: string;
  label: string;
  source?: string;
  variantId?: string;
  modelName?: string;
  sizeMultiplier?: number;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  totalR: number;
  avgR: number;
  maxDrawdownR: number;
  tradesPerDay: number;
  tradesPerWeek: number;
  pipOrTickSize?: number;
  tpUnits?: number;
  slUnits?: number;
  costUnits?: number;
  signalAtrMult?: number;
  recentSignalLookback?: number;
  absCloseEma200AtrMax?: number;
  tradeRsiMin?: number;
  tradeRsiMax?: number;
  invertSignal?: boolean;
};

export type BacktestTrade = {
  key: StrategyKey;
  logicalKey: string;
  datasetId: string;
  datasetLabel: string;
  market?: string;
  symbol: string;
  phase: string;
  label: string;
  source?: string;
  variantId?: string;
  modelName?: string;
  side: "long" | "short";
  entryIndex: number;
  exitIndex: number;
  signalTime: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  netUnits: number;
  rMultiple: number;
  tpUnits: number;
  slUnits: number;
  costUnits: number;
  exitReason: string;
  barsHeld: number;
};

export type BacktestAggregate = {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  totalR: number;
  avgR: number;
};

type StrategyCatalog = {
  stats: BacktestStat[];
  trades: BacktestTrade[];
};

type TradeSummary = BacktestAggregate & {
  tradesPerDay: number;
  tradesPerWeek: number;
  tpUnits?: number;
  slUnits?: number;
  costUnits?: number;
};

let catalogPromise: Promise<StrategyCatalog> | null = null;

const OPPOSITE_LABEL_SUFFIX = " [Opposite]";
const OPPOSITE_VARIANT_TOKEN = "inverse=1";
const MAX_OPPOSITE_STRATEGIES = 12;
const MIN_OPPOSITE_TRADES = 20;
const MIN_OPPOSITE_PROFIT_FACTOR = 1.4;
const MAX_OPPOSITE_AVG_R = 5;

function parseCsv(text: string): CsvRow[] {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  if (!headerLine) return [];
  const headers = headerLine.split(",");
  return lines
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(",");
      return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    });
}

function numeric(value: string | undefined): number {
  if (value && /^inf(?:inity)?$/i.test(value)) return Infinity;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumeric(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (/^inf(?:inity)?$/i.test(value)) return Infinity;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function strategyModelName(symbol: string, phase: string, source?: string, variantId?: string): string | undefined {
  const combined = `${source ?? ""}|${variantId ?? ""}`.toLowerCase();
  if (!combined.includes("precision_sprint")) return undefined;
  return benchmarkMlModelName(symbol, phase);
}

function strategyLabel(symbol: string, phase: string, source?: string, variantId?: string, mlModelName?: string): string {
  return strategyDisplayLabel({ symbol, phase, source, variantId, mlModelName });
}

async function readCsvRows(relativePath: string): Promise<CsvRow[]> {
  const text = await readFile(path.join(/* turbopackIgnore: true */ process.cwd(), relativePath), "utf8");
  return parseCsv(text);
}

function tradeSummary(trades: BacktestTrade[]): TradeSummary {
  const aggregate = aggregateBacktest(trades);
  const times = trades.map((trade) => Date.parse(trade.entryTime)).filter((time) => Number.isFinite(time));
  const start = times.length ? Math.min(...times) : Number.NaN;
  const end = times.length ? Math.max(...times) : Number.NaN;
  const days = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.max((end - start) / 86_400_000, 1) : 730;

  return {
    ...aggregate,
    tradesPerDay: aggregate.trades ? aggregate.trades / days : 0,
    tradesPerWeek: aggregate.trades ? aggregate.trades / (days / 7) : 0,
    tpUnits: average(trades.map((trade) => trade.tpUnits)),
    slUnits: average(trades.map((trade) => trade.slUnits)),
    costUnits: average(trades.map((trade) => trade.costUnits))
  };
}

function tradeTickSize(trades: BacktestTrade[], symbol: string, market?: string): number | undefined {
  const normalizedMarket = market === "futures" || market === "forex" || market === "gold_spot" ? market : undefined;
  return defaultTickSize(symbol, normalizedMarket);
}

function oppositeVariantId(variantId?: string): string {
  if (variantId?.includes(OPPOSITE_VARIANT_TOKEN)) return variantId;
  return variantId ? `${variantId}|${OPPOSITE_VARIANT_TOKEN}` : OPPOSITE_VARIANT_TOKEN;
}

function oppositeLabel(label: string): string {
  return label.endsWith(OPPOSITE_LABEL_SUFFIX) ? label : `${label}${OPPOSITE_LABEL_SUFFIX}`;
}

function oppositeExitReason(reason: string): string {
  const normalized = reason.toLowerCase();
  if (normalized === "tp") return "sl";
  if (normalized === "sl") return "tp";
  return reason;
}

function oppositeTrade(trade: BacktestTrade): BacktestTrade {
  const variantId = oppositeVariantId(trade.variantId);
  return {
    ...trade,
    key: strategyKey(trade.datasetId, trade.symbol, trade.phase, variantId),
    logicalKey: strategyLogicalKey(trade.symbol, trade.phase, variantId),
    label: oppositeLabel(trade.label),
    variantId,
    side: trade.side === "long" ? "short" : "long",
    netUnits: -trade.netUnits,
    rMultiple: -trade.rMultiple,
    exitReason: oppositeExitReason(trade.exitReason)
  };
}

function shouldAddOppositeStrategy(originalStat: BacktestStat, originalTrades: BacktestTrade[], oppositeSummary: TradeSummary): boolean {
  if (originalStat.invertSignal || !strategyPhaseIsLive(originalStat.phase)) return false;

  const originalAggregate = aggregateBacktest(originalTrades);
  if (originalAggregate.trades < MIN_OPPOSITE_TRADES) return false;
  if (!Number.isFinite(originalAggregate.avgR) || Math.abs(originalAggregate.avgR) > MAX_OPPOSITE_AVG_R) return false;
  if (originalAggregate.profitFactor >= 1) return false;
  if (!(oppositeSummary.profitFactor >= MIN_OPPOSITE_PROFIT_FACTOR)) return false;
  if (!(oppositeSummary.totalR > 0)) return false;
  return true;
}

function backtestTradeFromRow(row: CsvRow, dataset: StrategyDataset): BacktestTrade {
  const identity = rowIdentity(row, dataset);
  const modelName = strategyModelName(identity.symbol, identity.phase, identity.source, identity.variantId);
  const side: BacktestTrade["side"] = row.side === "short" ? "short" : "long";
  const explicitBarsHeld = numeric(row.bars_held);
  const entryIndex = numeric(row.entry_index);
  const exitIndex = numeric(row.exit_index);

  return {
    key: identity.key,
    logicalKey: identity.logicalKey,
    datasetId: identity.datasetId,
    datasetLabel: identity.datasetLabel,
    market: identity.market,
    symbol: identity.symbol,
    phase: identity.phase,
    label: strategyLabel(identity.symbol, identity.phase, identity.source, identity.variantId, modelName),
    source: identity.source,
    variantId: identity.variantId,
    modelName,
    side,
    entryIndex,
    exitIndex,
    signalTime: row.signal_time,
    entryTime: row.entry_time,
    exitTime: row.exit_time,
    entryPrice: numeric(row.entry_price),
    exitPrice: numeric(row.exit_price),
    netUnits: numeric(row.net_units),
    rMultiple: numeric(row.r_multiple),
    tpUnits: numeric(row.tp_units),
    slUnits: numeric(row.sl_units),
    costUnits: numeric(row.cost_units),
    exitReason: row.exit_reason,
    barsHeld: Math.max(1, explicitBarsHeld || exitIndex - entryIndex + 1)
  };
}

function numericFromCandidates(...values: Array<string | undefined>): number {
  for (const value of values) {
    if (value === undefined || value === "") continue;
    return numeric(value);
  }
  return 0;
}

function optionalNumericFromCandidates(...values: Array<string | undefined>): number | undefined {
  for (const value of values) {
    const parsed = optionalNumeric(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function backtestStatFromRow(row: CsvRow, dataset: StrategyDataset, trades: BacktestTrade[]): BacktestStat {
  const identity = rowIdentity(row, dataset);
  const modelName = strategyModelName(identity.symbol, identity.phase, identity.source, identity.variantId);
  const derived = tradeSummary(trades);
  const tpUnits = optionalNumericFromCandidates(row.tp_units, row.test_tp_units) ?? derived.tpUnits;
  const slUnits = optionalNumericFromCandidates(row.sl_units, row.test_sl_units) ?? derived.slUnits;
  const costUnits = optionalNumeric(row.cost_units) ?? derived.costUnits;
  const sizeMultiplier = optionalNumeric(row.size_multiplier) ?? recommendedSizeMultiplier({
    symbol: identity.symbol,
    tpUnits,
    slUnits,
    costUnits
  });
  const pipOrTickSize = optionalNumeric(row.pip_or_tick_size) ?? tradeTickSize(trades, identity.symbol, identity.market);

  return {
    key: identity.key,
    logicalKey: identity.logicalKey,
    datasetId: identity.datasetId,
    datasetLabel: identity.datasetLabel,
    market: identity.market,
    symbol: identity.symbol,
    phase: identity.phase,
    label: strategyLabel(identity.symbol, identity.phase, identity.source, identity.variantId, modelName),
    source: identity.source,
    variantId: identity.variantId,
    modelName,
    sizeMultiplier,
    trades: numericFromCandidates(row.test_r_trades, row.test_trades, row.trades) || derived.trades,
    wins: numericFromCandidates(row.test_r_wins, row.test_wins, row.wins) || derived.wins,
    losses: numericFromCandidates(row.test_r_losses, row.test_losses, row.losses) || derived.losses,
    winRatePct: numericFromCandidates(row.test_r_win_rate_pct, row.test_win_rate_pct, row.win_rate_pct) || derived.winRatePct,
    profitFactor:
      numericFromCandidates(row.test_r_profit_factor, row.profit_factor_r, row.test_profit_factor, row.profit_factor_dollars) ||
      derived.profitFactor,
    totalR: numericFromCandidates(row.test_r_total, row.total_r, row.test_total, row.total_pnl) || derived.totalR,
    avgR: numericFromCandidates(row.test_r_avg, row.avg_r, row.test_avg, row.avg_pnl) || derived.avgR,
    maxDrawdownR: numeric(row.max_drawdown_r),
    tradesPerDay: numericFromCandidates(row.test_trades_per_day, row.trades_per_day) || derived.tradesPerDay,
    tradesPerWeek: numericFromCandidates(row.test_trades_per_week, row.trades_per_week) || derived.tradesPerWeek,
    pipOrTickSize,
    tpUnits,
    slUnits,
    costUnits,
    signalAtrMult: optionalNumeric(row.signal_atr_mult),
    recentSignalLookback: optionalNumeric(row.recent_signal_lookback),
    absCloseEma200AtrMax: optionalNumeric(row.abs_close_ema200_atr_max),
    tradeRsiMin: optionalNumeric(row.trade_rsi_min),
    tradeRsiMax: optionalNumeric(row.trade_rsi_max)
  };
}

async function buildStrategyCatalog(): Promise<StrategyCatalog> {
  const tradesByKey = new Map<string, BacktestTrade[]>();
  const baseTrades = (
    await Promise.all(
      STRATEGY_DATASETS.map(async (dataset) => {
        const rows = await readCsvRows(dataset.tradesPath);
        return rows.map((row) => backtestTradeFromRow(row, dataset));
      })
    )
  )
    .flat()
    .sort((left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime));

  for (const trade of baseTrades) {
    const trades = tradesByKey.get(trade.key) ?? [];
    trades.push(trade);
    tradesByKey.set(trade.key, trades);
  }

  const stats = (
    await Promise.all(
      STRATEGY_DATASETS.map(async (dataset) => {
        const rows = await readCsvRows(dataset.statsPath);
        return rows.map((row) => {
          const key = rowIdentity(row, dataset).key;
          return backtestStatFromRow(row, dataset, tradesByKey.get(key) ?? []);
        });
      })
    )
  ).flat();

  const statByKey = new Map(stats.map((stat) => [stat.key, stat]));
  for (const [key, trades] of tradesByKey.entries()) {
    if (statByKey.has(key) || !trades.length) continue;
    const first = trades[0]!;
    const derived = tradeSummary(trades);
    statByKey.set(key, {
      key: first.key,
      logicalKey: first.logicalKey,
      datasetId: first.datasetId,
      datasetLabel: first.datasetLabel,
      market: first.market,
      symbol: first.symbol,
      phase: first.phase,
      label: first.label,
      source: first.source,
      variantId: first.variantId,
      modelName: first.modelName,
      sizeMultiplier: recommendedSizeMultiplier({
        symbol: first.symbol,
        tpUnits: derived.tpUnits,
        slUnits: derived.slUnits,
        costUnits: derived.costUnits
      }),
      trades: derived.trades,
      wins: derived.wins,
      losses: derived.losses,
      winRatePct: derived.winRatePct,
      profitFactor: derived.profitFactor,
      totalR: derived.totalR,
      avgR: derived.avgR,
      maxDrawdownR: 0,
      tradesPerDay: derived.tradesPerDay,
      tradesPerWeek: derived.tradesPerWeek,
      pipOrTickSize: tradeTickSize(trades, first.symbol, first.market),
      tpUnits: derived.tpUnits,
      slUnits: derived.slUnits,
      costUnits: derived.costUnits,
      signalAtrMult: undefined,
      recentSignalLookback: undefined,
      absCloseEma200AtrMax: undefined,
      tradeRsiMin: undefined,
      tradeRsiMax: undefined
    });
  }

  const baseStats = [...statByKey.values()];
  const oppositeCandidates = baseStats
    .map((stat) => {
      const originalTrades = tradesByKey.get(stat.key) ?? [];
      if (!originalTrades.length) return null;

      const mirroredTrades = originalTrades.map(oppositeTrade);
      const mirroredSummary = tradeSummary(mirroredTrades);
      if (!shouldAddOppositeStrategy(stat, originalTrades, mirroredSummary)) return null;

      const variantId = oppositeVariantId(stat.variantId);
      const mirroredStat: BacktestStat = {
        ...stat,
        key: strategyKey(stat.datasetId, stat.symbol, stat.phase, variantId),
        logicalKey: strategyLogicalKey(stat.symbol, stat.phase, variantId),
        label: oppositeLabel(stat.label),
        variantId,
        trades: mirroredSummary.trades,
        wins: mirroredSummary.wins,
        losses: mirroredSummary.losses,
        winRatePct: mirroredSummary.winRatePct,
        profitFactor: mirroredSummary.profitFactor,
        totalR: mirroredSummary.totalR,
        avgR: mirroredSummary.avgR,
        tradesPerDay: mirroredSummary.tradesPerDay,
        tradesPerWeek: mirroredSummary.tradesPerWeek,
        tpUnits: mirroredSummary.tpUnits ?? stat.tpUnits,
        slUnits: mirroredSummary.slUnits ?? stat.slUnits,
        costUnits: mirroredSummary.costUnits ?? stat.costUnits,
        invertSignal: true
      };

      return {
        originalProfitFactor: aggregateBacktest(originalTrades).profitFactor,
        originalTrades: originalTrades.length,
        oppositeProfitFactor: mirroredSummary.profitFactor,
        stat: mirroredStat,
        trades: mirroredTrades
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => {
      if (left.originalProfitFactor !== right.originalProfitFactor) {
        return left.originalProfitFactor - right.originalProfitFactor;
      }
      if (left.oppositeProfitFactor !== right.oppositeProfitFactor) {
        return right.oppositeProfitFactor - left.oppositeProfitFactor;
      }
      return right.originalTrades - left.originalTrades;
    })
    .slice(0, MAX_OPPOSITE_STRATEGIES);

  const allTrades = [...baseTrades, ...oppositeCandidates.flatMap((candidate) => candidate.trades)].sort(
    (left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime)
  );

  return {
    stats: [...baseStats, ...oppositeCandidates.map((candidate) => candidate.stat)],
    trades: allTrades
  };
}

async function loadStrategyCatalog(): Promise<StrategyCatalog> {
  if (!catalogPromise) {
    catalogPromise = buildStrategyCatalog();
  }
  return catalogPromise;
}

export async function getBacktestStats(): Promise<BacktestStat[]> {
  try {
    return (await loadStrategyCatalog()).stats;
  } catch {
    return [];
  }
}

export async function getBacktestTrades(): Promise<BacktestTrade[]> {
  try {
    return (await loadStrategyCatalog()).trades;
  } catch {
    return [];
  }
}

export function aggregateBacktest(trades: BacktestTrade[]): BacktestAggregate {
  const wins = trades.filter((trade) => trade.rMultiple > 0);
  const losses = trades.filter((trade) => trade.rMultiple < 0);
  const winR = wins.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const lossR = Math.abs(losses.reduce((sum, trade) => sum + trade.rMultiple, 0));
  const totalR = trades.reduce((sum, trade) => sum + trade.rMultiple, 0);
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: lossR ? winR / lossR : winR ? Infinity : 0,
    totalR,
    avgR: trades.length ? totalR / trades.length : 0
  };
}
