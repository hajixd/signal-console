import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMeanReversion } from "@/lib/strategy-runtime/mean-reversion";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "gold_futures_echo_neural_mean_reversion",
  label: "GC Echo Neural Mean Reversion",
  folder: "gold_futures_echo_neural_mean_reversion",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_futures",
  phase: "mean_reversion",
  liveEnabled: true,
  evaluator: evaluateMeanReversion,
  defaults: runtimeDefaultsFromMetadata(selection)
});
