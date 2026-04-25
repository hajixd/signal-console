import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditCapitulationReversion } from "@/lib/strategy-runtime/reddit-capitulation-reversion";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "silver_futures_reddit_capitulation_reversion",

  label: "SI Reddit Capitulation Reversion",

  folder: "silver_futures_reddit_capitulation_reversion",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "silver_futures",

  phase: "reddit_capitulation_reversion",

  liveEnabled: true,

  evaluator: evaluateRedditCapitulationReversion,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
