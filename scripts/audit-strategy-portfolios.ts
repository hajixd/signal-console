import { assetForKey } from "../src/lib/assets";
import { buildLocalStrategyCatalog, type BacktestTrade } from "../src/lib/backtest";
import { dollarPerUnit } from "../src/lib/instruments";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  dashboardSelectedStrategyIdsForMarket,
  enabledStrategyIdsForMarket,
  getLiveConfig,
  type DashboardMarket
} from "../src/lib/live-config";

type PortfolioMetrics = {
  firstTradeAt?: string;
  lastTradeAt?: string;
  profitFactor: number;
  rProfitFactor: number;
  strategyCount: number;
  tradeCount: number;
  tradesPerCalendarDay: number;
  tradesPerTradingDay: number;
};

type WeightedPortfolioMetrics = PortfolioMetrics & {
  highScaleStrategyCount: number;
  maximumScale: number;
  minimumScale: number;
};

function tradePnlDollars(trade: BacktestTrade, relativeScale = 1): number {
  const size = (trade.sizeMultiplierHint ?? 1) * relativeScale;
  const riskUnits = Math.abs(trade.slUnits) + Math.abs(trade.costUnits);
  const riskDollars = riskUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * size;
  return Number.isFinite(trade.rMultiple) && riskDollars > 0
    ? trade.rMultiple * riskDollars
    : trade.netUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * size;
}

function profitFactor(values: number[]): number {
  const grossProfit = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
}

function portfolioMetrics(
  trades: BacktestTrade[],
  strategyIds: Iterable<string>,
  relativeScaleById: ReadonlyMap<string, number> = new Map()
): PortfolioMetrics {
  const ids = new Set(strategyIds);
  const selected = trades.filter((trade) => ids.has(trade.datasetId));
  const timestamps = selected
    .map((trade) => Date.parse(trade.entryTime))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const first = timestamps[0];
  const last = timestamps.at(-1);
  const calendarDays = first !== undefined && last !== undefined
    ? Math.max(1, (last - first) / 86_400_000)
    : 1;
  const tradingDays = new Set(
    selected.map((trade) => trade.entryTime.slice(0, 10)).filter(Boolean)
  ).size;

  return {
    firstTradeAt: first === undefined ? undefined : new Date(first).toISOString(),
    lastTradeAt: last === undefined ? undefined : new Date(last).toISOString(),
    profitFactor: profitFactor(selected.map((trade) => tradePnlDollars(trade, relativeScaleById.get(trade.datasetId) ?? 1))),
    rProfitFactor: profitFactor(selected.map((trade) => trade.rMultiple)),
    strategyCount: ids.size,
    tradeCount: selected.length,
    tradesPerCalendarDay: selected.length / calendarDays,
    tradesPerTradingDay: tradingDays ? selected.length / tradingDays : 0
  };
}

function maximumProfitFactorAtBoundedScales(
  trades: BacktestTrade[],
  strategyIds: Iterable<string>,
  minimumScale = 0.5,
  maximumScale = 2
): WeightedPortfolioMetrics {
  const ids = [...new Set(strategyIds)];
  const pnlById = new Map<string, number[]>();
  for (const trade of trades) {
    if (!ids.includes(trade.datasetId)) continue;
    const bucket = pnlById.get(trade.datasetId) ?? [];
    bucket.push(tradePnlDollars(trade));
    pnlById.set(trade.datasetId, bucket);
  }
  const ranked = ids
    .map((id) => ({ id, pnl: pnlById.get(id) ?? [] }))
    .sort((left, right) => profitFactor(right.pnl) - profitFactor(left.pnl));
  let bestPf = 0;
  let bestHighScaleCount = 0;
  for (let highScaleCount = 0; highScaleCount <= ranked.length; highScaleCount += 1) {
    const weighted = ranked.flatMap((entry, index) =>
      entry.pnl.map((value) => value * (index < highScaleCount ? maximumScale : minimumScale))
    );
    const candidatePf = profitFactor(weighted);
    if (candidatePf > bestPf) {
      bestPf = candidatePf;
      bestHighScaleCount = highScaleCount;
    }
  }
  const base = portfolioMetrics(trades, ids);
  return {
    ...base,
    profitFactor: bestPf,
    highScaleStrategyCount: bestHighScaleCount,
    minimumScale,
    maximumScale
  };
}

function rounded(metrics: PortfolioMetrics): Record<string, string | number | undefined> {
  return {
    ...metrics,
    profitFactor: Number.isFinite(metrics.profitFactor) ? Number(metrics.profitFactor.toFixed(4)) : "Infinity",
    rProfitFactor: Number.isFinite(metrics.rProfitFactor) ? Number(metrics.rProfitFactor.toFixed(4)) : "Infinity",
    tradesPerCalendarDay: Number(metrics.tradesPerCalendarDay.toFixed(4)),
    tradesPerTradingDay: Number(metrics.tradesPerTradingDay.toFixed(4))
  };
}

async function main(): Promise<void> {
  const [catalog, config] = await Promise.all([buildLocalStrategyCatalog(), getLiveConfig()]);
  const validationCsv = readFileSync(path.join(process.cwd(), "Research", "reports", "stress_validation_catalog.csv"), "utf8")
    .trim()
    .split(/\r?\n/);
  const validationHeaders = validationCsv[0]?.split(",") ?? [];
  const strategyIdColumn = validationHeaders.indexOf("strategy_id");
  const statusColumn = validationHeaders.indexOf("status");
  const robustIds = new Set(
    validationCsv.slice(1)
      .map((line) => line.split(","))
      .filter((columns) => columns[statusColumn] === "pass")
      .map((columns) => columns[strategyIdColumn] ?? "")
      .filter(Boolean)
  );
  const idsByMarket = new Map<DashboardMarket, string[]>([["forex", []], ["futures", []]]);
  for (const entry of catalog.entries) {
    const market: DashboardMarket = assetForKey(entry.assetKey).market === "futures" ? "futures" : "forex";
    idsByMarket.get(market)!.push(entry.key);
  }

  const output: Record<string, unknown> = {};
  const savedScaleById = new Map(
    Object.entries(config.strategyEdits)
      .map(([id, edit]) => [id, Number(edit.scale)] as const)
      .filter((entry): entry is readonly [string, number] => Number.isFinite(entry[1]) && entry[1] > 0)
  );
  for (const market of ["forex", "futures"] as const) {
    const available = idsByMarket.get(market) ?? [];
    const enabled = enabledStrategyIdsForMarket(config, market).filter((id) => available.includes(id));
    const dashboard = dashboardSelectedStrategyIdsForMarket(config, market).filter((id) => available.includes(id));
    const active = enabled.length ? enabled : dashboard;
    const availableMetrics = portfolioMetrics(catalog.trades, available);
    const availableWide = maximumProfitFactorAtBoundedScales(catalog.trades, available, 0.1, 3);
    const robustIdsForMarket = available.filter((id) => robustIds.has(id));
    const robustMetrics = portfolioMetrics(catalog.trades, robustIdsForMarket);
    const robustWide = maximumProfitFactorAtBoundedScales(catalog.trades, robustIdsForMarket, 0.1, 3);
    output[market] = {
      target: { profitFactor: 3, tradesPerDay: 5 },
      targetFeasibleWithinCatalogAtWideScales:
        availableWide.profitFactor >= 3 && availableMetrics.tradesPerCalendarDay >= 5,
      targetFeasibleWithStressValidatedStrategiesAtWideScales:
        robustWide.profitFactor >= 3 && robustMetrics.tradesPerCalendarDay >= 5,
      available: rounded(availableMetrics),
      availableBoundedScaleUpperBound: rounded(maximumProfitFactorAtBoundedScales(catalog.trades, available)),
      availableWideScaleUpperBound: rounded(availableWide),
      robust: rounded(robustMetrics),
      robustBoundedScaleUpperBound: rounded(maximumProfitFactorAtBoundedScales(catalog.trades, robustIdsForMarket)),
      robustWideScaleUpperBound: rounded(robustWide),
      active: rounded(portfolioMetrics(catalog.trades, active, savedScaleById)),
      activeRobustOnly: rounded(portfolioMetrics(catalog.trades, active.filter((id) => robustIds.has(id)), savedScaleById)),
      activeStrategyIds: active
    };
  }

  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  writeFileSync(
    path.join(process.cwd(), "Research", "reports", "portfolio_feasibility_audit.json"),
    serialized,
    "utf8"
  );
  console.log(serialized.trimEnd());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
