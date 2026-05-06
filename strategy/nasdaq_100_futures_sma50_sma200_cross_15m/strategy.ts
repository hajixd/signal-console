import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMovingAverageCrossover } from "@/lib/strategy-runtime/moving-average-crossover";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "nasdaq_100_futures_sma50_sma200_cross_15m",
  label: "NQ 15m SMA50/SMA200 Cross",
  folder: "nasdaq_100_futures_sma50_sma200_cross_15m",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "moving_average_crossover",
  liveEnabled: true,
  evaluator: evaluateMovingAverageCrossover,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
