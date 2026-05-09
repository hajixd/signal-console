import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMomentum } from "@/lib/strategy-runtime/momentum";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "gold_futures_echo_neural_momentum",
  label: "GC Echo Neural Momentum",
  folder: "gold_futures_echo_neural_momentum",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_futures",
  phase: "momentum",
  liveEnabled: true,
  evaluator: evaluateMomentum,
  defaults: runtimeDefaultsFromMetadata(selection)
});
