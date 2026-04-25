import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditOrbBreakout } from "@/lib/strategy-runtime/reddit-orb-breakout";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "gold_futures_reddit_orb_breakout",

  label: "GC Reddit ORB Breakout",

  folder: "gold_futures_reddit_orb_breakout",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "gold_futures",

  phase: "reddit_orb_breakout",

  liveEnabled: true,

  evaluator: evaluateRedditOrbBreakout,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
