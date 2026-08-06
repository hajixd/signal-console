import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assetForKey } from "../src/lib/assets";
import { buildLocalStrategyCatalog, type BacktestTrade } from "../src/lib/backtest";
import { dollarPerUnit } from "../src/lib/instruments";
import {
  getLiveConfig,
  saveLiveConfig,
  withSavedStrategySelection,
  type DashboardMarket,
  type LiveConfig
} from "../src/lib/live-config";

const DEVELOPMENT_END_MS = Date.UTC(2025, 0, 1);
const MINIMUM_SCALE = 0.1;
const MAXIMUM_SCALE = 3;
const REPORT_ROOT = path.join(process.cwd(), "Research", "reports");

type PortfolioMetrics = {
  blockBootstrapPfP05: number;
  firstTradeAt?: string;
  lastTradeAt?: string;
  profitFactor: number;
  signFlipPValue: number;
  simpleBootstrapPfP05: number;
  strategyCount: number;
  tradeCount: number;
  tradesPerDay: number;
};

type FinalPortfolioReport = {
  applied: boolean;
  developmentPortfolio: PortfolioMetrics;
  fullPortfolio: PortfolioMetrics;
  market: DashboardMarket;
  relativeScaleByStrategy: Record<string, number>;
  sealedHoldoutPortfolio: PortfolioMetrics;
  selectedStrategyIds: string[];
  target: { profitFactor: number; tradesPerDay: number };
  targetMet: boolean;
  validationSources: { managementQualified: number; pooledQualified: number; stressQualified: number };
};

function csvRows(fileName: string): Record<string, string>[] {
  try {
    const lines = readFileSync(path.join(REPORT_ROOT, fileName), "utf8").trim().split(/\r?\n/);
    const headers = lines.shift()?.split(",") ?? [];
    return lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index] ?? String(index), value.replace(/^"|"$/g, "")])));
  } catch {
    return [];
  }
}

function tradePnlDollars(trade: BacktestTrade): number {
  const size = trade.sizeMultiplierHint ?? 1;
  return trade.rMultiple * (Math.abs(trade.slUnits) + Math.abs(trade.costUnits)) * dollarPerUnit(trade.symbol, trade.entryPrice) * size;
}

function profitFactor(values: number[]): number {
  const wins = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return losses > 0 ? wins / losses : wins > 0 ? Number.POSITIVE_INFINITY : 0;
}

function percentile(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * pct) - 1))] ?? 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function bootstrapPfP05(values: number[], block: boolean, seed: number): number {
  if (!values.length) return 0;
  const random = seededRandom(seed);
  const samples: number[] = [];
  const repetitions = block ? 500 : 800;
  const blockSize = 5;
  for (let sample = 0; sample < repetitions; sample += 1) {
    const draw: number[] = [];
    while (draw.length < values.length) {
      const start = Math.floor(random() * values.length);
      if (!block) {
        draw.push(values[start] ?? 0);
        continue;
      }
      for (let offset = 0; offset < blockSize && draw.length < values.length; offset += 1) {
        draw.push(values[(start + offset) % values.length] ?? 0);
      }
    }
    samples.push(profitFactor(draw));
  }
  return percentile(samples, 0.05);
}

function signFlipPValue(values: number[], seed: number): number {
  const observed = values.reduce((sum, value) => sum + value, 0);
  if (!values.length || observed <= 0) return 1;
  const random = seededRandom(seed);
  let atLeastObserved = 0;
  const samples = 1_000;
  for (let sample = 0; sample < samples; sample += 1) {
    const synthetic = values.reduce((sum, value) => sum + (random() >= 0.5 ? Math.abs(value) : -Math.abs(value)), 0);
    if (synthetic >= observed) atLeastObserved += 1;
  }
  return (atLeastObserved + 1) / (samples + 1);
}

function portfolioMetrics(
  trades: BacktestTrade[],
  selectedIds: string[],
  scaleById: ReadonlyMap<string, number>,
  seed: number
): PortfolioMetrics {
  const selected = new Set(selectedIds);
  const rows = trades
    .filter((trade) => selected.has(trade.datasetId))
    .sort((left, right) => Date.parse(left.entryTime) - Date.parse(right.entryTime));
  const values = rows.map((trade) => tradePnlDollars(trade) * (scaleById.get(trade.datasetId) ?? 1));
  const first = rows.length ? Date.parse(rows[0]!.entryTime) : undefined;
  const last = rows.length ? Math.max(...rows.map((trade) => Date.parse(trade.exitTime))) : undefined;
  const calendarDays = first !== undefined && last !== undefined && last > first ? (last - first) / 86_400_000 : 0;
  return {
    blockBootstrapPfP05: bootstrapPfP05(values, true, seed ^ 0xa5a5a5a5),
    firstTradeAt: first === undefined ? undefined : new Date(first).toISOString(),
    lastTradeAt: last === undefined ? undefined : new Date(last).toISOString(),
    profitFactor: profitFactor(values),
    signFlipPValue: signFlipPValue(values, seed ^ 0x517cc1b7),
    simpleBootstrapPfP05: bootstrapPfP05(values, false, seed),
    strategyCount: selectedIds.length,
    tradeCount: rows.length,
    tradesPerDay: calendarDays > 0 ? rows.length / calendarDays : 0
  };
}

function developmentScalePlan(trades: BacktestTrade[], selectedIds: string[]): Map<string, number> {
  const selected = new Set(selectedIds);
  const valuesById = new Map<string, number[]>();
  for (const trade of trades) {
    if (!selected.has(trade.datasetId) || Date.parse(trade.entryTime) >= DEVELOPMENT_END_MS) continue;
    const bucket = valuesById.get(trade.datasetId) ?? [];
    bucket.push(tradePnlDollars(trade));
    valuesById.set(trade.datasetId, bucket);
  }
  const ranked = selectedIds
    .map((id) => ({ id, values: valuesById.get(id) ?? [] }))
    .sort((left, right) => profitFactor(right.values) - profitFactor(left.values));
  let bestPf = 0;
  let bestHighCount = 0;
  for (let highCount = 0; highCount <= ranked.length; highCount += 1) {
    const weighted = ranked.flatMap((entry, index) => entry.values.map((value) => value * (index < highCount ? MAXIMUM_SCALE : MINIMUM_SCALE)));
    const candidate = profitFactor(weighted);
    if (candidate > bestPf) {
      bestPf = candidate;
      bestHighCount = highCount;
    }
  }
  return new Map(ranked.map((entry, index) => [entry.id, index < bestHighCount ? MAXIMUM_SCALE : MINIMUM_SCALE]));
}

function marketIds(catalog: Awaited<ReturnType<typeof buildLocalStrategyCatalog>>, market: DashboardMarket): Set<string> {
  return new Set(catalog.entries.filter((entry) => (assetForKey(entry.assetKey).market === "futures" ? "futures" : "forex") === market).map((entry) => entry.key));
}

function qualifiedIds(catalog: Awaited<ReturnType<typeof buildLocalStrategyCatalog>>, market: DashboardMarket): {
  ids: string[];
  counts: FinalPortfolioReport["validationSources"];
} {
  const available = marketIds(catalog, market);
  const stress = new Set(csvRows("stress_validation_catalog.csv").filter((row) => row.status === "pass" && available.has(row.strategy_id)).map((row) => row.strategy_id));
  const management = new Set(csvRows(`nested_management_${market}.csv`).filter((row) => ["eligible", "applied"].includes(row.status) && available.has(row.strategy_id)).map((row) => row.strategy_id));
  const pooled = new Set(catalog.trades.filter((trade) => available.has(trade.datasetId) && trade.source === "pooled_nested_session_2026_08").map((trade) => trade.datasetId));
  return {
    ids: [...new Set([...stress, ...management, ...pooled])].sort(),
    counts: { managementQualified: management.size, pooledQualified: pooled.size, stressQualified: stress.size }
  };
}

function rounded(report: FinalPortfolioReport): FinalPortfolioReport {
  return JSON.parse(JSON.stringify(report, (_key, value) => typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(6)) : value)) as FinalPortfolioReport;
}

function reportFor(catalog: Awaited<ReturnType<typeof buildLocalStrategyCatalog>>, market: DashboardMarket): FinalPortfolioReport {
  const qualified = qualifiedIds(catalog, market);
  const scales = developmentScalePlan(catalog.trades, qualified.ids);
  const developmentTrades = catalog.trades.filter((trade) => Date.parse(trade.entryTime) < DEVELOPMENT_END_MS);
  const holdoutTrades = catalog.trades.filter((trade) => Date.parse(trade.entryTime) >= DEVELOPMENT_END_MS);
  const seed = market === "forex" ? 0xf0e : 0xf07;
  const development = portfolioMetrics(developmentTrades, qualified.ids, scales, seed);
  const sealedHoldout = portfolioMetrics(holdoutTrades, qualified.ids, scales, seed ^ 0x2025);
  const full = portfolioMetrics(catalog.trades, qualified.ids, scales, seed ^ 0x2026);
  const targetMet =
    development.profitFactor > 1 &&
    development.simpleBootstrapPfP05 > 1 &&
    full.profitFactor >= 3 &&
    full.tradesPerDay >= 5 &&
    sealedHoldout.profitFactor > 1 &&
    sealedHoldout.simpleBootstrapPfP05 >= 0.9 &&
    sealedHoldout.blockBootstrapPfP05 >= 0.8 &&
    sealedHoldout.signFlipPValue <= 0.1;
  return rounded({
    applied: false,
    developmentPortfolio: development,
    fullPortfolio: full,
    market,
    relativeScaleByStrategy: Object.fromEntries(scales),
    sealedHoldoutPortfolio: sealedHoldout,
    selectedStrategyIds: qualified.ids,
    target: { profitFactor: 3, tradesPerDay: 5 },
    targetMet,
    validationSources: qualified.counts
  });
}

function withPortfolio(config: LiveConfig, report: FinalPortfolioReport): LiveConfig {
  const strategyEdits = { ...config.strategyEdits };
  for (const id of report.selectedStrategyIds) {
    strategyEdits[id] = { ...(strategyEdits[id] ?? {}), scale: report.relativeScaleByStrategy[id] ?? 1 };
  }
  return {
    ...withSavedStrategySelection({ ...config, strategyEdits }, report.selectedStrategyIds, { market: report.market }),
    strategyEdits
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const catalog = await buildLocalStrategyCatalog();
  const reports = (["forex", "futures"] as const).map((market) => reportFor(catalog, market));
  if (apply && !reports.every((report) => report.targetMet)) {
    throw new Error("Both markets must clear PF 3, visible 5 trades/day, and sealed-holdout gates before live configuration changes.");
  }
  if (apply) {
    let config = await getLiveConfig();
    for (const report of reports) config = withPortfolio(config, report);
    await saveLiveConfig(config);
    for (const report of reports) report.applied = true;
  }
  for (const report of reports) {
    writeFileSync(path.join(REPORT_ROOT, `final_validated_portfolio_${report.market}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(reports, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
