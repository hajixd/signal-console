import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMomentum } from "@/lib/strategy-runtime/momentum";
import selection from "./machine_learning/selection.json";


export default createStrategyDefinition({

  id: "nasdaq_100_futures_momentum",

  label: "NQ ML-Selected Momentum",

  folder: "nasdaq_100_futures_momentum",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "nasdaq_100_futures",

  phase: "momentum",

  liveEnabled: true,

  evaluator: evaluateMomentum,

  defaults: runtimeDefaultsFromMetadata(selection)
});
