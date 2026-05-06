import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluatePercentileRangeStudy } from "@/lib/strategy-runtime/percentile-range-study";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "nasdaq_100_futures_percentile_range_study_5m",
  label: "NQ Percentile Range Study 5m",
  folder: "nasdaq_100_futures_percentile_range_study_5m",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "percentile_range_study",
  liveEnabled: false,
  evaluator: evaluatePercentileRangeStudy,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
