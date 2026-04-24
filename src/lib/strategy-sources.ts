import type { Market } from "./types";

export type StrategyKey = string;

export type StrategyDataset = {
  id: string;
  label: string;
  statsPath: string;
  tradesPath: string;
  source: string;
  market?: Market;
  defaultVariantId?: string;
};

export type StrategyIdentity = {
  key: StrategyKey;
  logicalKey: string;
  datasetId: string;
  datasetLabel: string;
  market?: Market;
  symbol: string;
  phase: string;
  variantId?: string;
  source?: string;
};

export type CsvRow = Record<string, string>;

const DEFAULT_TICK_SIZES: Record<string, number> = {
  "6A": 0.00005,
  "6B": 0.0001,
  "6C": 0.00005,
  "6E": 0.00005,
  "6J": 0.0000005,
  AUDUSD: 0.0001,
  CL: 0.01,
  ES: 0.25,
  EURUSD: 0.0001,
  GC: 0.1,
  GBPUSD: 0.0001,
  HG: 0.0005,
  NG: 0.001,
  NQ: 0.25,
  NZDUSD: 0.0001,
  RTY: 0.1,
  SI: 0.005,
  USDCAD: 0.0001,
  USDCHF: 0.0001,
  USDJPY: 0.01,
  XAUUSD: 0.01,
  YM: 1,
  ZB: 0.03125,
  ZN: 0.015625
};

export const STRATEGY_DATASETS: StrategyDataset[] = [
  {
    id: "rule_holdout",
    label: "Rule-Based Holdout",
    statsPath: "data/strategy-results/live_realistic_holdout_summary_2022_to_present.csv",
    tradesPath: "data/strategy-results/live_realistic_holdout_trades_2022_to_present.csv",
    source: "rule_based"
  },
  {
    id: "ml_precision_sprint",
    label: "ML Precision Sprint",
    statsPath: "data/strategy-results/prop_challenge_precision_sprint_by_strategy.csv",
    tradesPath: "data/strategy-results/prop_challenge_precision_sprint_trades.csv",
    source: "precision_sprint",
    market: "futures",
    defaultVariantId: "precision_sprint"
  },
  {
    id: "deep_online",
    label: "Deep Online Research",
    statsPath: "data/strategy-results/deep_online_strategy_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/deep_online_strategy_quick_trades.csv",
    source: "deep_online_research"
  },
  {
    id: "known_trader",
    label: "Known Trader",
    statsPath: "data/strategy-results/known_trader_strategy_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_strategy_quick_trades.csv",
    source: "known_trader"
  },
  {
    id: "known_trader_fast_pass",
    label: "Known Trader Fast Pass",
    statsPath: "data/strategy-results/known_trader_fast_pass_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_fast_pass_quick_trades.csv",
    source: "known_trader"
  },
  {
    id: "strategy_family",
    label: "Strategy Family",
    statsPath: "data/strategy-results/strategy_family_targeted_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/strategy_family_targeted_trades.csv",
    source: "strategy_family"
  },
  {
    id: "strategy_family_mr_extra",
    label: "Strategy Family MR Extra",
    statsPath: "data/strategy-results/strategy_family_targeted_mr_extra_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/strategy_family_targeted_mr_extra_trades.csv",
    source: "strategy_family"
  },
  {
    id: "reddit_6a",
    label: "Reddit 6A",
    statsPath: "data/strategy-results/tmp_reddit_prop_6a_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/tmp_reddit_prop_6a_trades.csv",
    source: "reddit_research"
  },
  {
    id: "reddit_commodities",
    label: "Reddit Commodities",
    statsPath: "data/strategy-results/tmp_reddit_prop_commodities_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/tmp_reddit_prop_commodities_trades.csv",
    source: "reddit_research"
  },
  {
    id: "reddit_es20",
    label: "Reddit ES",
    statsPath: "data/strategy-results/tmp_reddit_prop_es20_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/tmp_reddit_prop_es20_trades.csv",
    source: "reddit_research"
  },
  {
    id: "reddit_esnq",
    label: "Reddit ES/NQ",
    statsPath: "data/strategy-results/tmp_reddit_prop_esnq_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/tmp_reddit_prop_esnq_trades.csv",
    source: "reddit_research"
  },
  {
    id: "reddit_fx_futures",
    label: "Reddit FX Futures",
    statsPath: "data/strategy-results/tmp_reddit_prop_fx_futures_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/tmp_reddit_prop_fx_futures_trades.csv",
    source: "reddit_research"
  },
  {
    id: "reddit_remaining",
    label: "Reddit Remaining",
    statsPath: "data/strategy-results/tmp_reddit_prop_remaining_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/tmp_reddit_prop_remaining_trades.csv",
    source: "reddit_research"
  },
  {
    id: "reddit_smoke",
    label: "Reddit Smoke",
    statsPath: "data/strategy-results/tmp_reddit_prop_smoke_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/tmp_reddit_prop_smoke_trades.csv",
    source: "reddit_research"
  },
  {
    id: "reddit_tiny",
    label: "Reddit Tiny",
    statsPath: "data/strategy-results/tmp_reddit_prop_tiny_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/tmp_reddit_prop_tiny_trades.csv",
    source: "reddit_research"
  },
  {
    id: "reddit_tiny_fast",
    label: "Reddit Tiny Fast",
    statsPath: "data/strategy-results/tmp_reddit_prop_tiny_fast_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/tmp_reddit_prop_tiny_fast_trades.csv",
    source: "reddit_research"
  },
  {
    id: "es_speed",
    label: "ES Speed",
    statsPath: "data/strategy-results/tmp_es_speed_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/tmp_es_speed_trades.csv",
    source: "strategy_family"
  }
];

const DATASET_BY_ID = new Map(STRATEGY_DATASETS.map((dataset) => [dataset.id, dataset]));

function isMarket(value: string | undefined): value is Market {
  return value === "futures" || value === "forex" || value === "gold_spot";
}

function splitPhaseKey(value: string | undefined): { symbol?: string; phase?: string } {
  if (!value || !value.includes(":")) return {};
  const [symbol, phase] = value.split(":", 2);
  return {
    symbol: symbol || undefined,
    phase: phase || undefined
  };
}

function splitSelectionKey(value: string | undefined): { symbol?: string; phase?: string; variantId?: string } {
  if (!value) return {};
  const [symbol, phase, ...rest] = value.split("\t");
  if (!symbol || !phase) return {};
  const variantId = rest.join("\t").trim();
  return {
    symbol,
    phase,
    variantId: variantId || undefined
  };
}

export function strategyLogicalKey(symbol: string, phase: string, variantId?: string): string {
  return `${symbol}\t${phase}\t${variantId ?? ""}`;
}

export function strategyKey(datasetId: string, symbol: string, phase: string, variantId?: string): StrategyKey {
  return `${datasetId}\t${strategyLogicalKey(symbol, phase, variantId)}`;
}

export function datasetById(datasetId: string): StrategyDataset | undefined {
  return DATASET_BY_ID.get(datasetId);
}

export function datasetLabel(datasetId: string): string {
  return DATASET_BY_ID.get(datasetId)?.label ?? datasetId;
}

export function rowSymbol(row: CsvRow): string {
  return row.symbol || splitSelectionKey(row.selection_key).symbol || splitPhaseKey(row.key).symbol || "";
}

export function rowPhase(row: CsvRow): string {
  return row.phase || row.strategy || splitSelectionKey(row.selection_key).phase || splitPhaseKey(row.key).phase || "unknown";
}

export function rowVariantId(row: CsvRow, dataset: StrategyDataset): string | undefined {
  const selectionVariant = splitSelectionKey(row.selection_key).variantId;
  const variantId = row.variant_id || selectionVariant || dataset.defaultVariantId;
  return variantId || undefined;
}

export function rowSource(row: CsvRow, dataset: StrategyDataset): string | undefined {
  return row.source || dataset.source || undefined;
}

export function rowMarket(row: CsvRow, dataset: StrategyDataset): Market | undefined {
  return isMarket(row.market) ? row.market : dataset.market;
}

export function rowIdentity(row: CsvRow, dataset: StrategyDataset): StrategyIdentity {
  const symbol = rowSymbol(row);
  const phase = rowPhase(row);
  const variantId = rowVariantId(row, dataset);
  return {
    key: strategyKey(dataset.id, symbol, phase, variantId),
    logicalKey: strategyLogicalKey(symbol, phase, variantId),
    datasetId: dataset.id,
    datasetLabel: dataset.label,
    market: rowMarket(row, dataset),
    symbol,
    phase,
    variantId,
    source: rowSource(row, dataset)
  };
}

export function defaultTickSize(symbol: string, market?: Market): number {
  if (symbol in DEFAULT_TICK_SIZES) return DEFAULT_TICK_SIZES[symbol]!;
  return market === "gold_spot" ? 0.01 : 0.0001;
}
