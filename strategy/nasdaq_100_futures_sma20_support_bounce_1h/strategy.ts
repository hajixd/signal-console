import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMovingAverageTouch } from "@/lib/strategy-runtime/moving-average-touch";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "nasdaq_100_futures_sma20_support_bounce_1h",
  label: "NQ 1h SMA20 Support Bounce",
  folder: "nasdaq_100_futures_sma20_support_bounce_1h",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "moving_average_touch",
  liveEnabled: false,
  evaluator: evaluateMovingAverageTouch,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
