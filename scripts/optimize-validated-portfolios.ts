import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { assetForKey } from "../src/lib/assets";
import { buildLocalStrategyCatalog, type BacktestTrade } from "../src/lib/backtest";
import { dollarPerUnit } from "../src/lib/instruments";
import { boundedTradeDollarPnl } from "../src/lib/live-trade-calculations";
import {
  getLiveConfig,
  saveLiveConfig,
  withSavedStrategySelection,
  type DashboardMarket,
  type LiveConfig
} from "../src/lib/live-config";

const DEVELOPMENT_END_MS = Date.UTC(2025, 0, 1);
const DEFAULT_FULL_PORTFOLIO_PF_TARGET = 3;
const DEFAULT_DEVELOPMENT_PF_TARGET = 3.25;
const REPORT_ROOT = path.join(process.cwd(), "Research", "reports");

type StrategyEdge = {
  annualGrossLoss: Record<string, number>;
  annualGrossProfit: Record<string, number>;
  fullGrossLoss: number;
  fullGrossProfit: number;
  holdoutGrossLoss: number;
  holdoutGrossProfit: number;
  id: string;
  grossLoss: number;
  grossProfit: number;
  tradeCount: number;
};

type Subset = {
  developmentEdge: number;
  fullEdge: number;
  mask: number;
  trades: number;
};

type PortfolioMetrics = {
  blockBootstrapPfP05: number;
  firstTradeAt?: string;
  lastTradeAt?: string;
  profitFactor: number;
  signFlipPValue: number;
  simpleBootstrapPfP05: number;
  strategyCount: number;
  tradeCount: number;
  tradesPerCalendarDay: number;
  tradesPerTradingDay: number;
  worstCalendarYearPf: number;
};

type PortfolioReport = {
  applied: boolean;
  annualProfitFactorTarget: number;
  candidatePolicy: "all_stress_tested" | "validated_only" | "validated_plus_relaxed_watch" | "validated_plus_stable_watch";
  development: PortfolioMetrics;
  developmentProfitFactorTarget: number;
  full: PortfolioMetrics;
  fullProfitFactorTarget: number;
  holdoutProfitFactorTarget: number;
  market: DashboardMarket;
  qualifiedStrategyCount: number;
  selectedStrategyIds: string[];
  selectedWatchStrategyIds: string[];
  validation: {
    eligibleStrategiesStressScreened: boolean;
    everySelectedStrategyFullyValidated: boolean;
    fullProfitFactorMet: boolean;
    holdoutPositive: boolean;
    holdoutSignificant: boolean;
    passed: boolean;
  };
  sealedHoldout: PortfolioMetrics;
};

function numericArg(flag: string, fallback: number): number {
  const raw = process.argv.find((value) => value.startsWith(`${flag}=`))?.slice(flag.length + 1);
  const value = Number(raw);
  return Number.isFinite(value) && value > 1 ? value : fallback;
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function tradePnlDollars(trade: BacktestTrade, range?: LiveConfig["customScaleRanges"][DashboardMarket]): number {
  const size = trade.sizeMultiplierHint ?? 1;
  const unitValue = dollarPerUnit(trade.symbol, trade.entryPrice) * size;
  const rawPnlDollars = trade.netUnits * unitValue;
  const targetDollars = Math.abs(trade.tpUnits * unitValue);
  const riskDollars = (Math.abs(trade.slUnits) + Math.abs(trade.costUnits)) * unitValue;
  const basePnlDollars = trade.managementEvents?.length
    ? rawPnlDollars
    : boundedTradeDollarPnl(rawPnlDollars, targetDollars, riskDollars);
  const targetCeiling = positiveNumber(range?.targetCeiling);
  const riskCeiling = positiveNumber(range?.riskCeiling);
  if (!targetCeiling || !riskCeiling || !(targetDollars > 0) || !(riskDollars > 0)) return basePnlDollars;
  const scale = Math.min(targetCeiling / targetDollars, riskCeiling / riskDollars);
  return basePnlDollars * (Number.isFinite(scale) && scale > 0 ? Number(scale.toFixed(6)) : 1);
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
  const repetitions = block ? 500 : 800;
  const blockSize = 5;
  const samples: number[] = [];
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
  const samples = 1_000;
  let atLeastObserved = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const synthetic = values.reduce((sum, value) => sum + (random() >= 0.5 ? Math.abs(value) : -Math.abs(value)), 0);
    if (synthetic >= observed) atLeastObserved += 1;
  }
  return (atLeastObserved + 1) / (samples + 1);
}

function portfolioMetrics(
  trades: BacktestTrade[],
  selectedIds: string[],
  seed: number,
  range?: LiveConfig["customScaleRanges"][DashboardMarket]
): PortfolioMetrics {
  const selected = new Set(selectedIds);
  const rows = trades
    .filter((trade) => selected.has(trade.datasetId))
    .sort((left, right) => Date.parse(left.entryTime) - Date.parse(right.entryTime));
  const values = rows.map((trade) => tradePnlDollars(trade, range));
  const first = rows.length ? Date.parse(rows[0]!.entryTime) : undefined;
  const last = rows.length ? Math.max(...rows.map((trade) => Date.parse(trade.exitTime))) : undefined;
  const calendarDays = first !== undefined && last !== undefined && last > first ? (last - first) / 86_400_000 : 0;
  const tradingDays = new Set(rows.map((trade) => trade.entryTime.slice(0, 10))).size;
  const valuesByYear = new Map<string, number[]>();
  for (let index = 0; index < rows.length; index += 1) {
    const year = rows[index]!.entryTime.slice(0, 4);
    const bucket = valuesByYear.get(year) ?? [];
    bucket.push(values[index] ?? 0);
    valuesByYear.set(year, bucket);
  }
  return {
    blockBootstrapPfP05: bootstrapPfP05(values, true, seed ^ 0xa5a5a5a5),
    firstTradeAt: first === undefined ? undefined : new Date(first).toISOString(),
    lastTradeAt: last === undefined ? undefined : new Date(last).toISOString(),
    profitFactor: profitFactor(values),
    signFlipPValue: signFlipPValue(values, seed ^ 0x517cc1b7),
    simpleBootstrapPfP05: bootstrapPfP05(values, false, seed),
    strategyCount: selectedIds.length,
    tradeCount: rows.length,
    tradesPerCalendarDay: calendarDays > 0 ? rows.length / calendarDays : 0,
    tradesPerTradingDay: tradingDays > 0 ? rows.length / tradingDays : 0,
    worstCalendarYearPf: valuesByYear.size ? Math.min(...[...valuesByYear.values()].map(profitFactor)) : 0
  };
}

type WatchTier = "all" | "none" | "relaxed" | "stable";

function stressScreenedIds(watchTier: WatchTier): { eligible: Set<string>; fullyValidated: Set<string> } {
  const lines = readFileSync(path.join(REPORT_ROOT, "stress_validation_catalog.csv"), "utf8").trim().split(/\r?\n/);
  const headers = lines.shift()?.split(",") ?? [];
  const index = (name: string) => headers.indexOf(name);
  const rows = lines.map((line) => line.split(","));
  const fullyValidated = new Set(
    rows.filter((columns) => columns[index("status")] === "pass").map((columns) => columns[index("strategy_id")] ?? "").filter(Boolean)
  );
  const eligible = new Set(fullyValidated);
  if (watchTier === "all") {
    for (const columns of rows) eligible.add(columns[index("strategy_id")] ?? "");
  } else if (watchTier !== "none") {
    for (const columns of rows) {
      if (columns[index("status")] !== "watch") continue;
      const metric = (name: string) => Number(columns[index(name)]);
      const thresholds = watchTier === "stable"
        ? { annual: 0.75, block: 0.8, bootstrap: 0.8, half: 0.9, overall: 1.4, quarter: 0.8, rolling: 0.8, worstYear: 0.7 }
        : { annual: 0.6, block: 0.7, bootstrap: 0.7, half: 0.8, overall: 1.25, quarter: 0.65, rolling: 0.7, worstYear: 0.5 };
      const screened =
        metric("overall_pf") >= thresholds.overall &&
        metric("min_half_pf") >= thresholds.half &&
        metric("min_quarter_pf") >= thresholds.quarter &&
        metric("rolling20_pf_p25") >= thresholds.rolling &&
        metric("bootstrap_pf_p05") >= thresholds.bootstrap &&
        metric("block_bootstrap_pf_p05") >= thresholds.block &&
        metric("annual_pass_rate") >= thresholds.annual &&
        metric("worst_annual_pf") >= thresholds.worstYear;
      if (screened) eligible.add(columns[index("strategy_id")] ?? "");
    }
  }
  eligible.delete("");
  return { eligible, fullyValidated };
}

function enumerateSubsets(entries: StrategyEdge[], developmentTargetPf: number, fullTargetPf: number): Subset[] {
  const subsets: Subset[] = [];
  const limit = 1 << entries.length;
  for (let mask = 0; mask < limit; mask += 1) {
    let developmentEdge = 0;
    let fullEdge = 0;
    let trades = 0;
    for (let index = 0; index < entries.length; index += 1) {
      if ((mask & (1 << index)) === 0) continue;
      const entry = entries[index]!;
      developmentEdge += entry.grossProfit - developmentTargetPf * entry.grossLoss;
      fullEdge += entry.fullGrossProfit - fullTargetPf * entry.fullGrossLoss;
      trades += entry.tradeCount;
    }
    subsets.push({ developmentEdge, fullEdge, mask, trades });
  }
  return subsets;
}

function betterSubset(left: Subset | undefined, right: Subset): Subset {
  if (!left || right.trades > left.trades) return right;
  if (
    right.trades === left.trades &&
    right.developmentEdge + right.fullEdge > left.developmentEdge + left.fullEdge
  ) return right;
  return left;
}

function lowerBound(values: number[], threshold: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] ?? Number.POSITIVE_INFINITY) < threshold) low = middle + 1;
    else high = middle;
  }
  return low;
}

function maximumFrequencySubset(
  entries: StrategyEdge[],
  developmentTargetPf: number,
  fullTargetPf: number,
  holdoutTargetPf: number,
  annualTargetPf: number
): string[] {
  if (entries.length > 40) {
    const result = spawnSync("python", [path.join(process.cwd(), "scripts", "portfolio_subset_milp.py")], {
      encoding: "utf8",
      input: JSON.stringify({ annualTargetPf, developmentTargetPf, entries, fullTargetPf, holdoutTargetPf })
    });
    if (result.status !== 0) throw new Error(result.stderr.trim() || "Portfolio MILP optimization failed.");
    return (JSON.parse(result.stdout) as { selectedStrategyIds: string[] }).selectedStrategyIds;
  }
  const split = Math.floor(entries.length / 2);
  const leftEntries = entries.slice(0, split);
  const rightEntries = entries.slice(split);
  const left = enumerateSubsets(leftEntries, developmentTargetPf, fullTargetPf)
    .sort((a, b) => a.developmentEdge - b.developmentEdge);
  const right = enumerateSubsets(rightEntries, developmentTargetPf, fullTargetPf)
    .sort((a, b) => b.developmentEdge - a.developmentEdge);
  const fullEdges = [...new Set(right.map((subset) => subset.fullEdge))].sort((a, b) => a - b);
  const fenwick = new Array<Subset | undefined>(fullEdges.length + 1);
  const update = (subset: Subset) => {
    const ascendingIndex = lowerBound(fullEdges, subset.fullEdge);
    for (let index = fullEdges.length - ascendingIndex; index < fenwick.length; index += index & -index) {
      fenwick[index] = betterSubset(fenwick[index], subset);
    }
  };
  const query = (minimumFullEdge: number): Subset | undefined => {
    const ascendingIndex = lowerBound(fullEdges, minimumFullEdge);
    let best: Subset | undefined;
    for (let index = fullEdges.length - ascendingIndex; index > 0; index -= index & -index) {
      if (fenwick[index]) best = betterSubset(best, fenwick[index]!);
    }
    return best;
  };

  let rightIndex = 0;
  let best: { left: Subset; right: Subset } | undefined;
  for (const leftSubset of left) {
    const minimumDevelopmentEdge = -leftSubset.developmentEdge;
    while (rightIndex < right.length && right[rightIndex]!.developmentEdge >= minimumDevelopmentEdge) {
      update(right[rightIndex]!);
      rightIndex += 1;
    }
    const rightSubset = query(-leftSubset.fullEdge);
    if (!rightSubset) continue;
    const candidateTrades = leftSubset.trades + rightSubset.trades;
    const bestTrades = best ? best.left.trades + best.right.trades : -1;
    const candidateEdge = leftSubset.developmentEdge + leftSubset.fullEdge + rightSubset.developmentEdge + rightSubset.fullEdge;
    const bestEdge = best
      ? best.left.developmentEdge + best.left.fullEdge + best.right.developmentEdge + best.right.fullEdge
      : Number.NEGATIVE_INFINITY;
    if (candidateTrades > bestTrades || (candidateTrades === bestTrades && candidateEdge > bestEdge)) {
      best = { left: leftSubset, right: rightSubset };
    }
  }
  if (!best) return [];

  return [
    ...leftEntries.filter((_entry, index) => (best!.left.mask & (1 << index)) !== 0),
    ...rightEntries.filter((_entry, index) => (best!.right.mask & (1 << index)) !== 0)
  ].map((entry) => entry.id);
}

function rounded<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => typeof item === "number" && Number.isFinite(item) ? Number(item.toFixed(6)) : item)
  ) as T;
}

function reportFor(
  catalog: Awaited<ReturnType<typeof buildLocalStrategyCatalog>>,
  market: DashboardMarket,
  eligibleIds: Set<string>,
  fullyValidatedIds: Set<string>,
  watchTier: WatchTier,
  developmentTarget: number,
  fullTarget: number,
  range?: LiveConfig["customScaleRanges"][DashboardMarket]
): PortfolioReport {
  const marketIds = new Set(
    catalog.entries
      .filter((entry) => (assetForKey(entry.assetKey).market === "futures" ? "futures" : "forex") === market)
      .map((entry) => entry.key)
  );
  const qualifiedIds = [...eligibleIds].filter((id) => marketIds.has(id));
  const developmentTrades = catalog.trades.filter((trade) => Date.parse(trade.entryTime) < DEVELOPMENT_END_MS);
  const sealedHoldoutTrades = catalog.trades.filter((trade) => Date.parse(trade.entryTime) >= DEVELOPMENT_END_MS);
  const holdoutTarget = watchTier === "all" ? fullTarget : 1;
  const annualTarget = 1;
  const edges = qualifiedIds.map((id) => {
    const developmentValues = developmentTrades
      .filter((trade) => trade.datasetId === id)
      .map((trade) => tradePnlDollars(trade, range));
    const fullValues = catalog.trades
      .filter((trade) => trade.datasetId === id)
      .map((trade) => tradePnlDollars(trade, range));
    const holdoutValues = sealedHoldoutTrades
      .filter((trade) => trade.datasetId === id)
      .map((trade) => tradePnlDollars(trade, range));
    const annualValues = new Map<string, number[]>();
    for (const trade of catalog.trades.filter((row) => row.datasetId === id)) {
      const year = trade.entryTime.slice(0, 4);
      const bucket = annualValues.get(year) ?? [];
      bucket.push(tradePnlDollars(trade, range));
      annualValues.set(year, bucket);
    }
    const annualGrossLoss = Object.fromEntries(
      [...annualValues].map(([year, values]) => [year, Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))])
    );
    const annualGrossProfit = Object.fromEntries(
      [...annualValues].map(([year, values]) => [year, values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)])
    );
    return {
      annualGrossLoss,
      annualGrossProfit,
      id,
      grossLoss: Math.abs(developmentValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0)),
      grossProfit: developmentValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0),
      fullGrossLoss: Math.abs(fullValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0)),
      fullGrossProfit: fullValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0),
      holdoutGrossLoss: Math.abs(holdoutValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0)),
      holdoutGrossProfit: holdoutValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0),
      tradeCount: fullValues.length
    };
  });
  const selectedStrategyIds = maximumFrequencySubset(
    edges,
    developmentTarget,
    fullTarget,
    holdoutTarget,
    annualTarget
  ).sort();
  const seed = market === "forex" ? 0xf0e : 0xf07;
  const development = portfolioMetrics(developmentTrades, selectedStrategyIds, seed, range);
  const sealedHoldout = portfolioMetrics(sealedHoldoutTrades, selectedStrategyIds, seed ^ 0x2025, range);
  const full = portfolioMetrics(catalog.trades, selectedStrategyIds, seed ^ 0x2026, range);
  const selectedWatchStrategyIds = selectedStrategyIds.filter((id) => !fullyValidatedIds.has(id));
  const validation = {
    eligibleStrategiesStressScreened: selectedStrategyIds.every((id) => eligibleIds.has(id)),
    everySelectedStrategyFullyValidated: selectedWatchStrategyIds.length === 0,
    fullProfitFactorMet: full.profitFactor >= fullTarget,
    holdoutPositive: sealedHoldout.profitFactor >= holdoutTarget && sealedHoldout.worstCalendarYearPf >= annualTarget,
    holdoutSignificant:
      sealedHoldout.simpleBootstrapPfP05 >= 0.9 &&
      sealedHoldout.blockBootstrapPfP05 >= 0.8 &&
      sealedHoldout.signFlipPValue <= 0.1,
    passed: false
  };
  validation.passed =
    validation.eligibleStrategiesStressScreened &&
    validation.fullProfitFactorMet &&
    validation.holdoutPositive &&
    validation.holdoutSignificant &&
    development.profitFactor >= developmentTarget;
  return rounded({
    applied: false,
    annualProfitFactorTarget: annualTarget,
    candidatePolicy:
      watchTier === "all"
        ? "all_stress_tested"
        : watchTier === "relaxed"
        ? "validated_plus_relaxed_watch"
        : watchTier === "stable"
          ? "validated_plus_stable_watch"
          : "validated_only",
    development,
    developmentProfitFactorTarget: developmentTarget,
    full,
    fullProfitFactorTarget: fullTarget,
    holdoutProfitFactorTarget: holdoutTarget,
    market,
    qualifiedStrategyCount: qualifiedIds.length,
    selectedStrategyIds,
    selectedWatchStrategyIds,
    validation,
    sealedHoldout
  });
}

function withPortfolio(config: LiveConfig, report: PortfolioReport): LiveConfig {
  const strategyEdits = { ...config.strategyEdits };
  for (const id of report.selectedStrategyIds) {
    strategyEdits[id] = { ...(strategyEdits[id] ?? {}), scale: 1 };
  }
  return {
    ...withSavedStrategySelection({ ...config, strategyEdits }, report.selectedStrategyIds, { market: report.market }),
    strategyEdits
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const requestedWatchTier = process.argv.find((value) => value.startsWith("--watch-tier="))?.split("=")[1];
  const watchTier: WatchTier = requestedWatchTier === "all" || requestedWatchTier === "relaxed" || requestedWatchTier === "stable"
    ? requestedWatchTier
    : process.argv.includes("--include-stable-watch")
      ? "stable"
      : "none";
  const requestedDevelopmentTarget = numericArg("--development-pf", DEFAULT_DEVELOPMENT_PF_TARGET);
  const fullTarget = numericArg("--portfolio-pf", DEFAULT_FULL_PORTFOLIO_PF_TARGET);
  const developmentTarget = process.argv.some((value) => value.startsWith("--development-pf="))
    ? requestedDevelopmentTarget
    : process.argv.some((value) => value.startsWith("--portfolio-pf="))
      ? fullTarget
      : requestedDevelopmentTarget;
  const catalog = await buildLocalStrategyCatalog();
  const screened = stressScreenedIds(watchTier);
  let config = await getLiveConfig();
  const reports = (["forex", "futures"] as const).map((market) =>
    reportFor(
      catalog,
      market,
      screened.eligible,
      screened.fullyValidated,
      watchTier,
      developmentTarget,
      fullTarget,
      config.customScaleRanges[market]
    )
  );
  if (apply && !reports.every((report) => report.validation.passed)) {
    throw new Error(`The optimized portfolios did not clear the PF ${fullTarget} and sealed-holdout gates; live configuration was not changed.`);
  }
  if (apply) {
    for (const report of reports) config = withPortfolio(config, report);
    await saveLiveConfig(config);
    for (const report of reports) report.applied = true;
  }
  const targetToken = Number.isInteger(fullTarget) ? String(fullTarget) : String(fullTarget).replace(".", "_");
  for (const report of reports) {
    writeFileSync(path.join(REPORT_ROOT, `maximum_frequency_pf${targetToken}_${report.market}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(reports, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
