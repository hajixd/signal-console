import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMomentum } from "@/lib/strategy-runtime/momentum";
import selection from "./machine_learning/selection.json";


export default createStrategyDefinition({

  id: "crude_oil_futures_momentum",

  label: "CL ML-Selected Momentum",

  folder: "crude_oil_futures_momentum",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "crude_oil_futures",

  phase: "momentum",

  liveEnabled: true,

  evaluator: evaluateMomentum,

  defaults: runtimeDefaultsFromMetadata(selection)
});
