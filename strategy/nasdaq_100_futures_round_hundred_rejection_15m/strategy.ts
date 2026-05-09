import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRoundNumberRejection } from "@/lib/strategy-runtime/round-number-rejection";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "nasdaq_100_futures_round_hundred_rejection_15m",
  label: "NQ Round Hundred Rejection 15m",
  folder: "nasdaq_100_futures_round_hundred_rejection_15m",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "round_number_rejection",
  liveEnabled: true,
  evaluator: evaluateRoundNumberRejection,
  defaults: runtimeDefaultsFromMetadata(selection)
});
