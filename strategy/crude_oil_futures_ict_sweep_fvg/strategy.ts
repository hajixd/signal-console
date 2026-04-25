import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateIctSweepFvg } from "@/lib/strategy-runtime/ict-sweep-fvg";
import selection from "./machine_learning/selection.json";


export default createStrategyDefinition({

  id: "crude_oil_futures_ict_sweep_fvg",

  label: "CL ML-Selected ICT Sweep FVG Reversal",

  folder: "crude_oil_futures_ict_sweep_fvg",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "crude_oil_futures",

  phase: "ict_sweep_fvg",

  liveEnabled: true,

  evaluator: evaluateIctSweepFvg,

  defaults: runtimeDefaultsFromMetadata(selection)
});
