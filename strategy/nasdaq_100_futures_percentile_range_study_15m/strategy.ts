import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluatePercentileRangeStudy } from "@/lib/strategy-runtime/percentile-range-study";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "nasdaq_100_futures_percentile_range_study_15m",
  label: "NQ Percentile Range Study 15m",
  folder: "nasdaq_100_futures_percentile_range_study_15m",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "percentile_range_study",
  liveEnabled: true,
  evaluator: evaluatePercentileRangeStudy,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
