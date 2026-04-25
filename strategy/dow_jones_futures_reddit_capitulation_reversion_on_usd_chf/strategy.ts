import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditCapitulationReversion } from "@/lib/strategy-runtime/reddit-capitulation-reversion";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "dow_jones_futures_reddit_capitulation_reversion_on_usd_chf",

  label: "YM Reddit Capitulation Reversion on USD/CHF",

  folder: "dow_jones_futures_reddit_capitulation_reversion_on_usd_chf",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "usd_chf",

  phase: "reddit_capitulation_reversion",

  liveEnabled: true,

  evaluator: evaluateRedditCapitulationReversion,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
