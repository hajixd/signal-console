import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMeanReversion } from "@/lib/strategy-runtime/mean-reversion";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "gold_spot_echo_neural_mean_reversion_balanced",
  label: "XAUUSD Echo Neural Mean Reversion Balanced",
  folder: "gold_spot_echo_neural_mean_reversion_balanced",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_spot",
  phase: "mean_reversion",
  liveEnabled: true,
  evaluator: evaluateMeanReversion,
  defaults: runtimeDefaultsFromMetadata(selection)
});
