import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMomentum } from "@/lib/strategy-runtime/momentum";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "us_treasury_10y_note_futures_momentum_opposite",

  label: "US Treasury 10Y Note Momentum Opposite",

  folder: "us_treasury_10y_note_futures_momentum_opposite",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "us_treasury_10y_note_futures",

  phase: "momentum",

  liveEnabled: true,

  evaluator: evaluateMomentum,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
