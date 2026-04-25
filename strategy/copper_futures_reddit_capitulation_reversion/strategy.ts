import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditCapitulationReversion } from "@/lib/strategy-runtime/reddit-capitulation-reversion";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "copper_futures_reddit_capitulation_reversion",

  label: "HG Reddit Capitulation Reversion",

  folder: "copper_futures_reddit_capitulation_reversion",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "copper_futures",

  phase: "reddit_capitulation_reversion",

  liveEnabled: true,

  evaluator: evaluateRedditCapitulationReversion,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
