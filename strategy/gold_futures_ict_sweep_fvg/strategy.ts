import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateIctSweepFvg } from "@/lib/strategy-runtime/ict-sweep-fvg";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "gold_futures_ict_sweep_fvg",

  label: "GC Precision Sprint ICT Sweep FVG Reversal",

  folder: "gold_futures_ict_sweep_fvg",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "gold_futures",

  phase: "ict_sweep_fvg",

  liveEnabled: true,

  evaluator: evaluateIctSweepFvg,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
