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
  riskRewardRatio?: number;
  minimumRiskReward?: number;
  selectedRiskReward?: number;
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

export type StrategyCatalog = {
  catalogVersion?: number;
  computedThroughAt?: string;
  computedThroughByStrategy?: Record<
    string,
    {
      assetKey: string;
      lastBarAt?: string;
      lastBarTime?: number;
      timeframe: string;
    }
  >;
  entries: StrategyCatalogEntry[];
  generatedAt?: string;
  stats: BacktestStat[];
  trades: BacktestTrade[];
};

type CsvRow = Record<string, string>;

const BACKTEST_MANIFEST_PATH = "cache/backtest-manifest.json";
const STRATEGY_ROOT = "strategy";
const TIMEFRAME_ORDER = ["1m", "5m", "10m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"] as const;
const CATALOG_CACHE_TTL_MS = 60_000;
const MANIFEST_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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
  const timeframe = variantText(strategy.defaults?.variantId, "tf");
  const executionTimeframe = variantText(strategy.defaults?.variantId, "exec_tf");
  const timeframes = new Set<string>([timeframe || "15m"]);
  if (executionTimeframe) {
    timeframes.add(executionTimeframe);
  }
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
  const headers = parseCsvLine(headerLine);
  return lines
    .filter(Boolean)
    .map((line) => {
      const cells = parseCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    });
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current);
  return cells;
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

function variantText(variantId: string | undefined, key: string): string | undefined {
  if (!variantId) return undefined;
  for (const token of variantId.split("|")) {
    const [tokenKey, rawValue] = token.split("=", 2);
    if (tokenKey === key && rawValue) return rawValue;
  }
  return undefined;
}

function positiveNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function ratioFromUnits(tpUnits: number | undefined, slUnits: number | undefined): number | undefined {
  const riskUnits = positiveNumber(slUnits);
  return riskUnits ? positiveNumber((tpUnits ?? 0) / riskUnits) : undefined;
}

function averageTradeRiskReward(trades: BacktestTrade[]): number | undefined {
  return average(
    trades
      .map((trade) => ratioFromUnits(Math.abs(trade.tpUnits), Math.abs(trade.slUnits)))
      .filter((value): value is number => value !== undefined)
  );
}

function plannedRiskReward(strategy: StrategyDefinition, variantId: string | undefined, trades: BacktestTrade[]): number | undefined {
  const defaults = strategy.defaults ?? {};
  return (
    positiveNumber(defaults.selectedRiskReward) ??
    positiveNumber(variantNumber(variantId, "risk_reward", "rr")) ??
    positiveNumber(defaults.minimumRiskReward) ??
    positiveNumber(defaults.ictRiskReward) ??
    averageTradeRiskReward(trades)
  );
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
  const tpUnits = average(trades.map((trade) => trade.tpUnits));
  const slUnits = average(trades.map((trade) => trade.slUnits));
  const riskRewardRatio = plannedRiskReward(strategy, first.variantId, trades) ?? ratioFromUnits(tpUnits, slUnits);

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
        tpUnits,
        slUnits
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
    tpUnits,
    slUnits,
    riskRewardRatio,
    minimumRiskReward: strategy.defaults?.minimumRiskReward,
    selectedRiskReward: strategy.defaults?.selectedRiskReward ?? riskRewardRatio,
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

function roundedCatalogNumber(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : "";
}

function catalogStatRiskReward(stat: BacktestStat): number | undefined {
  return positiveNumber(stat.riskRewardRatio) ?? ratioFromUnits(stat.tpUnits, stat.slUnits);
}

function catalogHasCurrentStrategyDrift(manifest: StrategyCatalog, local: StrategyCatalog): boolean {
  if (manifest.entries.length !== local.entries.length || manifest.stats.length !== local.stats.length) return true;

  const manifestStats = new Map(manifest.stats.map((stat) => [stat.datasetId, stat]));
  for (const localStat of local.stats) {
    const manifestStat = manifestStats.get(localStat.datasetId);
    if (!manifestStat) return true;
    if ((manifestStat.variantId ?? "") !== (localStat.variantId ?? "")) return true;
    if (roundedCatalogNumber(catalogStatRiskReward(manifestStat)) !== roundedCatalogNumber(catalogStatRiskReward(localStat))) return true;
    if (roundedCatalogNumber(manifestStat.tpUnits) !== roundedCatalogNumber(localStat.tpUnits)) return true;
    if (roundedCatalogNumber(manifestStat.slUnits) !== roundedCatalogNumber(localStat.slUnits)) return true;
  }

  return false;
}

function shouldUseLocalCatalog(manifest: StrategyCatalog, local: StrategyCatalog, manifestLatestTradeTime: number): boolean {
  if (local.stats.length < manifest.stats.length || local.trades.length < manifest.trades.length) return false;
  return latestTradeTime(local) > manifestLatestTradeTime || catalogHasCurrentStrategyDrift(manifest, local);
}

function latestTradeTime(catalog: StrategyCatalog | null): number {
  if (!catalog?.trades.length) return 0;
  return Math.max(
    ...catalog.trades
      .flatMap((trade) => [trade.signalTime, trade.entryTime, trade.exitTime])
      .map((value) => Date.parse(value))
      .filter(Number.isFinite)
  );
}

function isoFromMillis(value: number): string | undefined {
  return value > 0 && Number.isFinite(value) ? new Date(value).toISOString() : undefined;
}

export async function buildLocalStrategyCatalog(strategyIds?: Iterable<string>): Promise<StrategyCatalog> {
  const selectedStrategyIds = strategyIds ? new Set(strategyIds) : null;
  const strategies = selectedStrategyIds
    ? STRATEGY_DEFINITIONS.filter((strategy) => selectedStrategyIds.has(strategy.id))
    : STRATEGY_DEFINITIONS;
  const trades: BacktestTrade[] = [];

  for (const strategy of strategies) {
    const csvPath = path.posix.join(STRATEGY_ROOT, strategy.folder, strategy.backtestFileName);
    const rows = await readCsvRows(csvPath, "local");
    for (const row of rows) {
      try {
        const trade = backtestTradeFromRow(row, strategy);
        if (trade) trades.push(trade);
      } catch (error) {
        console.warn(`Skipping malformed backtest row in ${csvPath}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  }

  trades.sort((left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime));

  const stats = strategies.flatMap((strategy) => {
    const strategyTrades = trades.filter((trade) => trade.datasetId === strategy.id);
    return strategyTrades.length ? [backtestStatFromTrades(strategy, strategyTrades)] : [];
  });

  return {
    entries: strategies.map((strategy) => {
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
  const manifest = await readManifestCatalog();
  if (!manifest) return buildLocalStrategyCatalog();

  if (process.env.BACKTEST_FORCE_LOCAL === "1") return buildLocalStrategyCatalog();

  const manifestLatestTradeTime = latestTradeTime(manifest);
  const manifestComputedThroughTime = Date.parse(manifest.computedThroughAt ?? "");
  const manifestFreshnessTime = Number.isFinite(manifestComputedThroughTime)
    ? manifestComputedThroughTime
    : manifestLatestTradeTime;
  const local = await buildLocalStrategyCatalog().catch(() => null);
  if (manifestFreshnessTime && Date.now() - manifestFreshnessTime <= MANIFEST_STALE_AFTER_MS) {
    if (local && shouldUseLocalCatalog(manifest, local, manifestLatestTradeTime)) return local;
    return manifest;
  }

  return local && shouldUseLocalCatalog(manifest, local, manifestLatestTradeTime) ? local : manifest;
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

export async function getBacktestCatalogFreshness(): Promise<{
  computedThroughAt?: string;
  generatedAt?: string;
  latestTradeAt?: string;
  trades: number;
}> {
  try {
    const catalog = await loadStrategyCatalog();
    return {
      computedThroughAt: catalog.computedThroughAt,
      generatedAt: catalog.generatedAt,
      latestTradeAt: isoFromMillis(latestTradeTime(catalog)),
      trades: catalog.trades.length
    };
  } catch {
    return {
      trades: 0
    };
  }
}

export { aggregateBacktest };
