import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMomentum } from "@/lib/strategy-runtime/momentum";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "gold_futures_echo_neural_momentum_balanced",
  label: "GC Echo Neural Momentum Balanced",
  folder: "gold_futures_echo_neural_momentum_balanced",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_futures",
  phase: "momentum",
  liveEnabled: true,
  evaluator: evaluateMomentum,
  defaults: runtimeDefaultsFromMetadata(selection)
});
