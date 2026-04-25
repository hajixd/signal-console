import { analyzePropFirmChallenge, DEFAULT_CHALLENGE_RULES } from "@/lib/challenge";
import { buildLocalStrategyCatalog, type BacktestStat, type BacktestTrade } from "@/lib/backtest";
import { dollarPerUnit } from "@/lib/instruments";
import { TOPSTEP_100K_ACCOUNT, topstepMaxPositionSizeForSymbol } from "@/lib/topstep";

type StrategyData = {
  id: string;
  label: string;
  symbol: string;
  phase: string;
  profitFactor: number;
  winRatePct: number;
  trades: number;
  tradesPerWeek: number;
  maxScale: number;
  scaleGrid: number[];
  baseTrades: BasketTrade[];
};

type BasketTrade = {
  key: string;
  entryTime: string;
  pnlDollars: number;
};

type BasketMetrics = {
  tradeCount: number;
  tradesPerWeek: number;
  profitFactor: number;
  totalPnl: number;
  historicalPass7d: number;
  monteCarloPass7d: number;
  historicalPass14d: number;
  monteCarloPass14d: number;
  historicalPass30d: number;
  monteCarloPass30d: number;
  historicalPassEventual: number;
  monteCarloPassEventual: number;
  historicalAvgDaysToPass: number;
  monteCarloAvgDaysToPass: number;
};

type BasketResult = {
  ids: string[];
  scales: Record<string, number>;
  metrics: BasketMetrics;
  score: number;
};

const MAX_BASKET_SIZE = Number(process.env.MAX_BASKET_SIZE ?? 8);
const START_COUNT = Number(process.env.START_COUNT ?? 6);
const SHORTLIST_COUNT = Number(process.env.SHORTLIST_COUNT ?? 18);
const SCALE_GRID = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8];

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rateValue(metrics: BasketMetrics, key: keyof BasketMetrics): number {
  const value = metrics[key];
  return typeof value === "number" ? value : 0;
}

function basketScore(metrics: BasketMetrics): number {
  const min7 = Math.min(metrics.historicalPass7d, metrics.monteCarloPass7d);
  const min14 = Math.min(metrics.historicalPass14d, metrics.monteCarloPass14d);
  const min30 = Math.min(metrics.historicalPass30d, metrics.monteCarloPass30d);
  const minEventual = Math.min(metrics.historicalPassEventual, metrics.monteCarloPassEventual);
  const passSpeedPenalty =
    Math.max(0, metrics.historicalAvgDaysToPass - 7) * 15 + Math.max(0, metrics.monteCarloAvgDaysToPass - 7) * 15;

  return (
    min7 * 1_000_000 +
    (metrics.historicalPass7d + metrics.monteCarloPass7d) * 10_000 +
    min14 * 1_000 +
    min30 * 100 +
    minEventual * 10 +
    Math.min(metrics.profitFactor, 8) +
    Math.min(metrics.tradesPerWeek, 500) / 1_000 -
    passSpeedPenalty
  );
}

function tradeBasePnl(trade: BacktestTrade): number {
  return trade.netUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * (trade.sizeMultiplierHint ?? 1);
}

function tradeBaseRiskDollars(trade: BacktestTrade): number {
  return Math.abs(trade.slUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * (trade.sizeMultiplierHint ?? 1));
}

function tradeBaseTargetDollars(trade: BacktestTrade): number {
  return Math.abs(trade.tpUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * (trade.sizeMultiplierHint ?? 1));
}

function strategyScaleGrid(stat: BacktestStat | undefined, trades: BacktestTrade[]): number[] {
  if (!trades.length) return [1];
  const symbol = trades[0]!.symbol;
  const baseContracts = Math.max(
    stat?.sizeMultiplier ?? 1,
    ...trades.map((trade) => trade.sizeMultiplierHint ?? stat?.sizeMultiplier ?? 1)
  );
  const positionCap = baseContracts > 0 ? topstepMaxPositionSizeForSymbol(symbol) / baseContracts : 0;
  const maxRiskBase = Math.max(...trades.map((trade) => tradeBaseRiskDollars(trade)), 0);
  const maxTargetBase = Math.max(...trades.map((trade) => tradeBaseTargetDollars(trade)), 0);
  const riskCap = maxRiskBase > 0 ? TOPSTEP_100K_ACCOUNT.maxPerTradeRisk / maxRiskBase : Infinity;
  const targetCap = maxTargetBase > 0 ? (TOPSTEP_100K_ACCOUNT.bestDayRecommendation - 1) / maxTargetBase : Infinity;
  const maxScale = Math.max(0.05, Math.min(positionCap, riskCap, targetCap, 8));
  return SCALE_GRID.filter((scale) => scale <= maxScale + 1e-9)
    .map(rounded)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function metricsFromBasketTrades(trades: BasketTrade[]): Pick<BasketMetrics, "tradeCount" | "tradesPerWeek" | "profitFactor" | "totalPnl"> {
  const pnl = trades.map((trade) => trade.pnlDollars);
  const grossWin = pnl.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(pnl.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const times = trades.map((trade) => Date.parse(trade.entryTime)).filter((value) => Number.isFinite(value));
  const days = times.length ? Math.max((Math.max(...times) - Math.min(...times)) / 86_400_000, 1) : 1;
  return {
    tradeCount: trades.length,
    tradesPerWeek: trades.length / (days / 7),
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0,
    totalPnl: pnl.reduce((sum, value) => sum + value, 0)
  };
}

function passRate(summary: ReturnType<typeof analyzePropFirmChallenge>, method: "historical" | "monteCarlo", key: "7d" | "14d" | "30d" | "eventual"): number {
  const rates = method === "historical" ? summary.historicalPassRates : summary.monteCarloPassRates;
  return rates.find((rate) => rate.key === key)?.passRatePct ?? 0;
}

const evaluationCache = new Map<string, BasketMetrics>();

function buildBasketTrades(strategyMap: Map<string, StrategyData>, ids: string[], scales: Record<string, number>): BasketTrade[] {
  return ids
    .flatMap((id) => {
      const strategy = strategyMap.get(id);
      if (!strategy) return [];
      const scale = scales[id] ?? 1;
      return strategy.baseTrades.map((trade) => ({
        key: id,
        entryTime: trade.entryTime,
        pnlDollars: trade.pnlDollars * scale
      }));
    })
    .sort((left, right) => Date.parse(left.entryTime) - Date.parse(right.entryTime));
}

function evaluateBasket(strategyMap: Map<string, StrategyData>, ids: string[], scales: Record<string, number>): BasketMetrics {
  const scaleKey = ids.map((id) => `${id}:${(scales[id] ?? 1).toFixed(4)}`).join("|");
  const cached = evaluationCache.get(scaleKey);
  if (cached) return cached;

  const trades = buildBasketTrades(strategyMap, ids, scales);
  const summary = analyzePropFirmChallenge(trades, `search:${scaleKey}`, DEFAULT_CHALLENGE_RULES);
  const basketBase = metricsFromBasketTrades(trades);
  const metrics: BasketMetrics = {
    ...basketBase,
    historicalPass7d: passRate(summary, "historical", "7d"),
    monteCarloPass7d: passRate(summary, "monteCarlo", "7d"),
    historicalPass14d: passRate(summary, "historical", "14d"),
    monteCarloPass14d: passRate(summary, "monteCarlo", "14d"),
    historicalPass30d: passRate(summary, "historical", "30d"),
    monteCarloPass30d: passRate(summary, "monteCarlo", "30d"),
    historicalPassEventual: passRate(summary, "historical", "eventual"),
    monteCarloPassEventual: passRate(summary, "monteCarlo", "eventual"),
    historicalAvgDaysToPass: summary.historical.avgMinutesToPass / 1_440,
    monteCarloAvgDaysToPass: summary.monteCarlo.avgMinutesToPass / 1_440
  };
  evaluationCache.set(scaleKey, metrics);
  return metrics;
}

function optimizeScales(strategyMap: Map<string, StrategyData>, ids: string[], initialScales: Record<string, number>, rounds = 2): BasketResult {
  let scales = { ...initialScales };
  let metrics = evaluateBasket(strategyMap, ids, scales);
  let improved = true;
  let round = 0;

  while (improved && round < rounds) {
    improved = false;
    round += 1;
    for (const id of ids) {
      const strategy = strategyMap.get(id);
      if (!strategy) continue;
      let bestScale = scales[id] ?? 1;
      let bestMetrics = metrics;
      for (const scale of strategy.scaleGrid) {
        if (Math.abs(scale - (scales[id] ?? 1)) < 1e-9) continue;
        const nextScales = { ...scales, [id]: scale };
        const nextMetrics = evaluateBasket(strategyMap, ids, nextScales);
        if (basketScore(nextMetrics) > basketScore(bestMetrics)) {
          bestScale = scale;
          bestMetrics = nextMetrics;
        }
      }
      if (Math.abs(bestScale - (scales[id] ?? 1)) > 1e-9) {
        scales[id] = bestScale;
        metrics = bestMetrics;
        improved = true;
      }
    }
  }

  return { ids: [...ids], scales, metrics, score: basketScore(metrics) };
}

function pruneBasket(strategyMap: Map<string, StrategyData>, result: BasketResult): BasketResult {
  let current = result;
  let improved = true;
  while (improved && current.ids.length > 1) {
    improved = false;
    for (const id of current.ids) {
      const ids = current.ids.filter((value) => value !== id);
      const scales = Object.fromEntries(ids.map((value) => [value, current.scales[value] ?? 1]));
      const candidate = optimizeScales(strategyMap, ids, scales, 1);
      if (candidate.score > current.score) {
        current = candidate;
        improved = true;
        break;
      }
    }
  }
  return current;
}

function describeResult(strategyMap: Map<string, StrategyData>, result: BasketResult): string[] {
  return result.ids.map((id) => {
    const strategy = strategyMap.get(id);
    const scale = result.scales[id] ?? 1;
    if (!strategy) return `${id} x${scale.toFixed(2)}`;
    return `${id} x${scale.toFixed(2)} (${strategy.symbol} ${strategy.phase}, PF ${strategy.profitFactor.toFixed(2)}, ${strategy.tradesPerWeek.toFixed(1)}/wk)`;
  });
}

function printResult(strategyMap: Map<string, StrategyData>, title: string, result: BasketResult) {
  console.log(`\n${title}`);
  console.log(
    [
      `  7d hist ${result.metrics.historicalPass7d.toFixed(1)}%`,
      `7d mc ${result.metrics.monteCarloPass7d.toFixed(1)}%`,
      `14d hist ${result.metrics.historicalPass14d.toFixed(1)}%`,
      `14d mc ${result.metrics.monteCarloPass14d.toFixed(1)}%`,
      `30d hist ${result.metrics.historicalPass30d.toFixed(1)}%`,
      `30d mc ${result.metrics.monteCarloPass30d.toFixed(1)}%`
    ].join(" | ")
  );
  console.log(
    [
      `  eventual hist ${result.metrics.historicalPassEventual.toFixed(1)}%`,
      `eventual mc ${result.metrics.monteCarloPassEventual.toFixed(1)}%`,
      `PF ${Number.isFinite(result.metrics.profitFactor) ? result.metrics.profitFactor.toFixed(2) : "inf"}`,
      `trades/week ${result.metrics.tradesPerWeek.toFixed(1)}`,
      `avg pass days hist ${result.metrics.historicalAvgDaysToPass.toFixed(2)}`,
      `avg pass days mc ${result.metrics.monteCarloAvgDaysToPass.toFixed(2)}`
    ].join(" | ")
  );
  for (const line of describeResult(strategyMap, result)) {
    console.log(`  - ${line}`);
  }
}

function greedySearch(
  strategyMap: Map<string, StrategyData>,
  start: BasketResult,
  candidateIds: string[]
): BasketResult {
  let current = start;
  while (current.ids.length < MAX_BASKET_SIZE) {
    let bestNext = current;
    for (const id of candidateIds) {
      if (current.ids.includes(id)) continue;
      const ids = [...current.ids, id].sort();
      const initialScales = { ...current.scales, [id]: strategyMap.get(id)?.scaleGrid.includes(1) ? 1 : strategyMap.get(id)?.scaleGrid.at(-1) ?? 1 };
      const candidate = optimizeScales(strategyMap, ids, initialScales, 1);
      if (candidate.score > bestNext.score) {
        bestNext = candidate;
      }
    }
    if (bestNext.score <= current.score) break;
    current = pruneBasket(strategyMap, bestNext);
  }
  return current;
}

async function main() {
  const catalog = await buildLocalStrategyCatalog();
  const statById = new Map(catalog.stats.map((stat) => [stat.datasetId, stat]));
  const tradesById = new Map<string, BacktestTrade[]>();
  for (const trade of catalog.trades) {
    const bucket = tradesById.get(trade.datasetId) ?? [];
    bucket.push(trade);
    tradesById.set(trade.datasetId, bucket);
  }

  const strategies: StrategyData[] = [...tradesById.keys()]
    .map((id) => {
      const stat = statById.get(id);
      const trades = (tradesById.get(id) ?? []).sort((left, right) => Date.parse(left.entryTime) - Date.parse(right.entryTime));
      if (!stat || !trades.length) return null;
      const scaleGrid = strategyScaleGrid(stat, trades);
      return {
        id,
        label: stat.label,
        symbol: stat.symbol,
        phase: stat.phase,
        profitFactor: stat.profitFactor,
        winRatePct: stat.winRatePct,
        trades: stat.trades,
        tradesPerWeek: stat.tradesPerWeek,
        maxScale: scaleGrid.at(-1) ?? 1,
        scaleGrid,
        baseTrades: trades.map((trade) => ({
          key: id,
          entryTime: trade.entryTime,
          pnlDollars: tradeBasePnl(trade)
        }))
      } satisfies StrategyData;
    })
    .filter((strategy): strategy is StrategyData => Boolean(strategy));

  const strategyMap = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  console.log(`Loaded ${strategies.length} strategies with ${catalog.trades.length} local backtest trades.`);

  const singles = strategies
    .map((strategy) => {
      const initialScale = strategy.scaleGrid.includes(1) ? 1 : strategy.scaleGrid.at(-1) ?? 1;
      return optimizeScales(strategyMap, [strategy.id], { [strategy.id]: initialScale }, 1);
    })
    .sort((left, right) => right.score - left.score);

  console.log("\nTop single strategies:");
  for (const single of singles.slice(0, 10)) {
    const strategy = strategyMap.get(single.ids[0]!)!;
    console.log(
      `- ${strategy.id} x${single.scales[strategy.id]!.toFixed(2)} | 7d hist ${single.metrics.historicalPass7d.toFixed(1)}% | 7d mc ${single.metrics.monteCarloPass7d.toFixed(1)}% | PF ${strategy.profitFactor.toFixed(2)} | trades/week ${strategy.tradesPerWeek.toFixed(1)}`
    );
  }

  const shortlistIds = singles.slice(0, SHORTLIST_COUNT).map((single) => single.ids[0]!);
  const searchStarts = singles.slice(0, START_COUNT);
  const results: BasketResult[] = [];

  for (const start of searchStarts) {
    const result = greedySearch(strategyMap, start, shortlistIds);
    results.push(result);
  }

  const siblingInspiredSeeds = [
    [
      "crude_oil_futures_ict_sweep_fvg",
      "crude_oil_futures_momentum",
      "gold_futures_reddit_ema_pullback",
      "gold_futures_reddit_orb_breakout",
      "copper_futures_reddit_capitulation_reversion",
      "nasdaq_100_futures_momentum",
      "russell_2000_futures_reddit_orb_retest",
      "silver_futures_reddit_capitulation_reversion"
    ],
    [
      "eur_usd_ny_sweep_bayes",
      "gbp_usd_ny_sweep_bayes",
      "nzd_usd_ny_sweep_bayes",
      "usd_jpy_ny_sweep_bayes",
      "usd_cad_ny_sweep_bayes",
      "aud_usd_ny_sweep_bayes_prior_day_target"
    ]
  ];

  for (const seedIds of siblingInspiredSeeds) {
    const ids = seedIds.filter((id) => strategyMap.has(id));
    if (!ids.length) continue;
    const initialScales = Object.fromEntries(ids.map((id) => [id, strategyMap.get(id)!.scaleGrid.includes(1) ? 1 : strategyMap.get(id)!.scaleGrid.at(-1) ?? 1]));
    results.push(optimizeScales(strategyMap, ids.sort(), initialScales, 1));
  }

  const deduped = new Map<string, BasketResult>();
  for (const result of results) {
    const key = result.ids.join("|");
    const existing = deduped.get(key);
    if (!existing || result.score > existing.score) {
      deduped.set(key, result);
    }
  }

  const finalists = [...deduped.values()].sort((left, right) => right.score - left.score).slice(0, 8);
  const validated = finalists
    .map((result) => optimizeScales(strategyMap, result.ids, result.scales, 2))
    .sort((left, right) => right.score - left.score);

  for (const [index, result] of validated.entries()) {
    printResult(strategyMap, `Finalist #${index + 1}`, result);
  }

  const winner = validated[0];
  if (!winner) {
    console.log("\nNo basket found.");
    return;
  }

  printResult(strategyMap, "Winner", winner);
  console.log(
    `\nGoal check: 7d historical ${winner.metrics.historicalPass7d.toFixed(1)}% | 7d Monte Carlo ${winner.metrics.monteCarloPass7d.toFixed(1)}%`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
