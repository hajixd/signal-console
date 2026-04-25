import path from "node:path";
import { assetForKey, assetForSymbol, isMarket, type Market } from "@/lib/assets";
import { recommendedSizeMultiplier } from "@/lib/instruments";
import { readProjectText, readProjectTextIfExists } from "@/lib/project-assets";
import type { StrategyDefinition } from "@/lib/strategy-definition";
import { STRATEGY_DEFINITIONS } from "@/lib/strategy-loader";

export type StrategyKey = string;
export type BacktestPriceMode = "fixed" | "custom";
export type BacktestSizeMode = "auto" | "custom";

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
  tpMode?: BacktestPriceMode;
  slMode?: BacktestPriceMode;
  sizeMode?: BacktestSizeMode;
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
  tpMode?: BacktestPriceMode;
  slMode?: BacktestPriceMode;
  sizeMode?: BacktestSizeMode;
  costUnits: number;
  exitReason: string;
  barsHeld: number;
  assetKey: string;
  strategyId: string;
  sizeMultiplierHint?: number;
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

export type StrategyCatalogEntry = {
  key: string;
  label: string;
  folder: string;
  fileCode?: string;
  liveSupported: boolean;
  assetKey: string;
  symbol: string;
  market: Market;
  timeframes: string[];
};

type StrategyCatalog = {
  entries: StrategyCatalogEntry[];
  stats: BacktestStat[];
  trades: BacktestTrade[];
};

type CsvRow = Record<string, string>;

const BACKTEST_MANIFEST_PATH = "cache/backtest-manifest.json";
const STRATEGY_ROOT = "strategy";
const TIMEFRAME_ORDER = ["15m", "30m", "45m", "1h", "4h", "1d", "1w"] as const;
const CATALOG_CACHE_TTL_MS = 60_000;

let catalogCache: { promise: Promise<StrategyCatalog>; loadedAt: number } | null = null;

function timeframeOrder(value: string): number {
  const index = TIMEFRAME_ORDER.indexOf(value as (typeof TIMEFRAME_ORDER)[number]);
  return index >= 0 ? index : TIMEFRAME_ORDER.length;
}

function strategyUsesPriorDayStructure(strategy: StrategyDefinition): boolean {
  const defaults = strategy.defaults ?? {};
  return (
    strategy.phase === "ict_sweep_fvg" ||
    strategy.phase === "ict_turtle_soup" ||
    defaults.stopLossPolicy?.mode === "prior_day_extreme" ||
    defaults.takeProfitPolicy?.mode === "prior_day_extreme"
  );
}

function strategyTimeframes(strategy: StrategyDefinition): string[] {
  const timeframes = new Set<string>(["15m"]);
  if (strategyUsesPriorDayStructure(strategy)) {
    timeframes.add("1d");
  }
  return [...timeframes].sort((left, right) => timeframeOrder(left) - timeframeOrder(right));
}

function strategyLogicalKey(symbol: string, phase: string, variantId?: string): string {
  return `${symbol}\t${phase}\t${variantId ?? ""}`;
}

function strategyKey(strategyId: string, symbol: string, phase: string, variantId?: string): StrategyKey {
  return `${strategyId}\t${strategyLogicalKey(symbol, phase, variantId)}`;
}

function parseCsv(text: string): CsvRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const [headerLine, ...lines] = trimmed.split(/\r?\n/);
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

function priceMode(value: string | undefined): BacktestPriceMode | undefined {
  return value === "custom" ? "custom" : value === "fixed" ? "fixed" : undefined;
}

function sizeMode(value: string | undefined): BacktestSizeMode | undefined {
  return value === "custom" ? "custom" : value === "auto" ? "auto" : undefined;
}

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasMeaningfulVariation(values: number[], precision = 4): boolean {
  const distinct = new Set(
    values
      .filter((value) => Number.isFinite(value))
      .map((value) => value.toFixed(precision))
  );
  return distinct.size > 1;
}

function variantNumber(variantId: string | undefined, ...keys: string[]): number | undefined {
  if (!variantId) return undefined;
  for (const token of variantId.split("|")) {
    const [key, rawValue] = token.split("=", 2);
    if (!keys.includes(key) || rawValue === undefined || rawValue === "" || rawValue === "none") continue;
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

async function readCsvRows(filePath: string, mode: "auto" | "local" | "remote" = "auto"): Promise<CsvRow[]> {
  try {
    return parseCsv(await readProjectText(filePath, mode));
  } catch {
    return [];
  }
}

function aggregateBacktest(trades: BacktestTrade[]): BacktestAggregate {
  const wins = trades.filter((trade) => trade.rMultiple > 0);
  const losses = trades.filter((trade) => trade.rMultiple < 0);
  const grossWins = wins.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.rMultiple, 0));
  const totalR = trades.reduce((sum, trade) => sum + trade.rMultiple, 0);
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLosses ? grossWins / grossLosses : grossWins ? Infinity : 0,
    totalR,
    avgR: trades.length ? totalR / trades.length : 0
  };
}

function maxDrawdownR(trades: BacktestTrade[]): number {
  let equityR = 0;
  let peakR = 0;
  let maxDrawdown = 0;
  const ordered = [...trades].sort((left, right) => Date.parse(left.exitTime) - Date.parse(right.exitTime));
  for (const trade of ordered) {
    equityR += trade.rMultiple;
    peakR = Math.max(peakR, equityR);
    maxDrawdown = Math.max(maxDrawdown, peakR - equityR);
  }
  return maxDrawdown;
}

function tradeCadence(trades: BacktestTrade[]): { tradesPerDay: number; tradesPerWeek: number } {
  const times = trades.map((trade) => Date.parse(trade.entryTime)).filter((value) => Number.isFinite(value));
  if (!times.length) {
    return { tradesPerDay: 0, tradesPerWeek: 0 };
  }
  const start = Math.min(...times);
  const end = Math.max(...times);
  const days = Math.max((end - start) / 86_400_000, 1);
  return {
    tradesPerDay: trades.length / days,
    tradesPerWeek: trades.length / (days / 7)
  };
}

function backtestTradeFromRow(row: CsvRow, strategy: StrategyDefinition): BacktestTrade | null {
  const assetKey = (row.asset_key ?? strategy.assetKey ?? "").trim();
  if (!assetKey) return null;
  const asset = assetForKey(assetKey);
  const symbol = (row.symbol ?? asset.symbol).trim().toUpperCase();
  const phase = (row.phase || "").trim();
  if (!symbol || !phase) return null;

  const variantId = (row.variant_id ?? "").trim() || strategy.defaults?.variantId || undefined;
  const logicalKey = strategyLogicalKey(symbol, phase, variantId);

  return {
    key: strategyKey(strategy.id, symbol, phase, variantId),
    logicalKey,
    datasetId: strategy.id,
    datasetLabel: strategy.label,
    market: isMarket(row.market) ? row.market : asset.market,
    symbol,
    phase,
    label: strategy.label,
    source: row.source || strategy.defaults?.source || "python_backtest",
    variantId,
    modelName: strategy.label,
    side: row.side === "short" ? "short" : "long",
    entryIndex: numeric(row.entry_index),
    exitIndex: numeric(row.exit_index),
    signalTime: row.signal_time || row.entry_time || "",
    entryTime: row.entry_time || row.signal_time || "",
    exitTime: row.exit_time || row.entry_time || "",
    entryPrice: numeric(row.entry_price),
    exitPrice: numeric(row.exit_price),
    netUnits: numeric(row.net_units),
    rMultiple: numeric(row.r_multiple),
    tpUnits: numeric(row.tp_units),
    slUnits: numeric(row.sl_units),
    tpMode: priceMode(row.tp_mode),
    slMode: priceMode(row.sl_mode),
    sizeMode: sizeMode(row.size_mode),
    costUnits: numeric(row.cost_units),
    exitReason: row.exit_reason || "end",
    barsHeld: Math.max(1, numeric(row.bars_held) || numeric(row.exit_index) - numeric(row.entry_index) + 1),
    assetKey,
    strategyId: row.strategy_id || strategy.id,
    sizeMultiplierHint: optionalNumeric(row.size_multiplier) ?? strategy.defaults?.sizeMultiplier
  };
}

function backtestStatFromTrades(strategy: StrategyDefinition, trades: BacktestTrade[]): BacktestStat {
  const first = trades[0]!;
  const aggregate = aggregateBacktest(trades);
  const cadence = tradeCadence(trades);
  const asset = first.assetKey ? assetForKey(first.assetKey) : assetForSymbol(first.symbol);
  const sizeMultiplierHint = average(trades.map((trade) => trade.sizeMultiplierHint).filter((value): value is number => value !== undefined));
  const signalAtrMult = variantNumber(first.variantId, "sig", "signal_atr_mult") ?? strategy.defaults?.signalAtrMult;
  const recentSignalLookback = variantNumber(first.variantId, "lookback") ?? strategy.defaults?.recentSignalLookback;
  const absCloseEma200AtrMax =
    variantNumber(first.variantId, "abs", "abs_close_ema200_atr_max") ?? strategy.defaults?.absCloseEma200AtrMax;
  const tradeRsiMin = variantNumber(first.variantId, "rsi_min", "trade_rsi_min") ?? strategy.defaults?.tradeRsiMin;
  const tradeRsiMax =
    variantNumber(first.variantId, "rsi_max", "rsi2", "rsi2_max", "trade_rsi_max") ?? strategy.defaults?.tradeRsiMax;
  const tpMode: BacktestPriceMode =
    trades.some((trade) => trade.tpMode === "custom") || hasMeaningfulVariation(trades.map((trade) => trade.tpUnits)) ? "custom" : "fixed";
  const slMode: BacktestPriceMode =
    trades.some((trade) => trade.slMode === "custom") || hasMeaningfulVariation(trades.map((trade) => trade.slUnits)) ? "custom" : "fixed";
  const sizeModeValue: BacktestSizeMode = trades.some((trade) => trade.sizeMode === "custom") ? "custom" : "auto";

  return {
    key: first.key,
    logicalKey: first.logicalKey,
    datasetId: strategy.id,
    datasetLabel: strategy.label,
    market: first.market,
    symbol: first.symbol,
    phase: first.phase,
    label: strategy.label,
    source: first.source || strategy.defaults?.source,
    variantId: first.variantId,
    modelName: strategy.label,
    sizeMultiplier:
      sizeMultiplierHint ??
      strategy.defaults?.sizeMultiplier ??
      recommendedSizeMultiplier({
        symbol: first.symbol,
        tpUnits: average(trades.map((trade) => trade.tpUnits)),
        slUnits: average(trades.map((trade) => trade.slUnits))
      }),
    trades: aggregate.trades,
    wins: aggregate.wins,
    losses: aggregate.losses,
    winRatePct: aggregate.winRatePct,
    profitFactor: aggregate.profitFactor,
    totalR: aggregate.totalR,
    avgR: aggregate.avgR,
    maxDrawdownR: maxDrawdownR(trades),
    tradesPerDay: cadence.tradesPerDay,
    tradesPerWeek: cadence.tradesPerWeek,
    pipOrTickSize: asset?.tickSize,
    tpUnits: average(trades.map((trade) => trade.tpUnits)),
    slUnits: average(trades.map((trade) => trade.slUnits)),
    tpMode,
    slMode,
    sizeMode: sizeModeValue,
    costUnits: average(trades.map((trade) => trade.costUnits)),
    signalAtrMult,
    recentSignalLookback,
    absCloseEma200AtrMax,
    tradeRsiMin,
    tradeRsiMax,
    invertSignal: first.variantId?.includes("inverse=1") || strategy.defaults?.invertSignal || false
  };
}

async function readManifestCatalog(): Promise<StrategyCatalog | null> {
  const raw = await readProjectTextIfExists(BACKTEST_MANIFEST_PATH);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StrategyCatalog;
    if (Array.isArray(parsed.entries) && Array.isArray(parsed.stats) && Array.isArray(parsed.trades)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export async function buildLocalStrategyCatalog(): Promise<StrategyCatalog> {
  const trades: BacktestTrade[] = [];

  for (const strategy of STRATEGY_DEFINITIONS) {
    const csvPath = path.posix.join(STRATEGY_ROOT, strategy.folder, strategy.backtestFileName);
    const rows = await readCsvRows(csvPath, "local");
    trades.push(
      ...rows
        .map((row) => backtestTradeFromRow(row, strategy))
        .filter((trade): trade is BacktestTrade => Boolean(trade))
    );
  }

  trades.sort((left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime));

  const stats = STRATEGY_DEFINITIONS.flatMap((strategy) => {
    const strategyTrades = trades.filter((trade) => trade.datasetId === strategy.id);
    return strategyTrades.length ? [backtestStatFromTrades(strategy, strategyTrades)] : [];
  });

  return {
    entries: STRATEGY_DEFINITIONS.map((strategy) => {
      const asset = assetForKey(strategy.assetKey);
      return {
      key: strategy.id,
      label: strategy.label,
      folder: strategy.folder,
      fileCode: strategy.fileName,
      liveSupported: strategy.liveEnabled,
      assetKey: asset.key,
      symbol: asset.symbol,
      market: asset.market,
      timeframes: strategyTimeframes(strategy)
      };
    }),
    stats,
    trades
  };
}

async function buildStrategyCatalog(): Promise<StrategyCatalog> {
  return (await readManifestCatalog()) ?? buildLocalStrategyCatalog();
}

async function loadStrategyCatalog(): Promise<StrategyCatalog> {
  const now = Date.now();
  if (!catalogCache || now - catalogCache.loadedAt > CATALOG_CACHE_TTL_MS) {
    catalogCache = {
      promise: buildStrategyCatalog(),
      loadedAt: now
    };
  }
  return catalogCache.promise;
}

export async function getStrategyCatalog(): Promise<StrategyCatalogEntry[]> {
  try {
    return (await loadStrategyCatalog()).entries;
  } catch {
    return [];
  }
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

export { aggregateBacktest };
