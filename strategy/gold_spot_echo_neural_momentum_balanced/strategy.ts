import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMomentum } from "@/lib/strategy-runtime/momentum";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "gold_spot_echo_neural_momentum_balanced",
  label: "XAUUSD Echo Neural Momentum Balanced",
  folder: "gold_spot_echo_neural_momentum_balanced",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_spot",
  phase: "momentum",
  liveEnabled: true,
  evaluator: evaluateMomentum,
  defaults: runtimeDefaultsFromMetadata(selection)
});
