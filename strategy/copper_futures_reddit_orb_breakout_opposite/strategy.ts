import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditOrbBreakout } from "@/lib/strategy-runtime/reddit-orb-breakout";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "copper_futures_reddit_orb_breakout_opposite",

  label: "HG Reddit ORB Breakout Opposite",

  folder: "copper_futures_reddit_orb_breakout_opposite",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "copper_futures",

  phase: "reddit_orb_breakout",

  liveEnabled: true,

  evaluator: evaluateRedditOrbBreakout,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
