import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateMeanReversion } from "@/lib/strategy-runtime/mean-reversion";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "gbp_usd_mean_reversion",

  label: "GBP/USD Walk-Forward Mean Reversion",

  folder: "gbp_usd_mean_reversion",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "gbp_usd",

  phase: "mean_reversion",

  liveEnabled: true,

  evaluator: evaluateMeanReversion,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
