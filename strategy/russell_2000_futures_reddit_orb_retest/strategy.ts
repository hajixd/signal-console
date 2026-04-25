import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditOrbRetest } from "@/lib/strategy-runtime/reddit-orb-retest";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "russell_2000_futures_reddit_orb_retest",

  label: "RTY Reddit ORB Retest Breakout",

  folder: "russell_2000_futures_reddit_orb_retest",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "russell_2000_futures",

  phase: "reddit_orb_retest",

  liveEnabled: true,

  evaluator: evaluateRedditOrbRetest,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
