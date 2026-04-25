import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditOrbBreakout } from "@/lib/strategy-runtime/reddit-orb-breakout";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "nasdaq_100_futures_reddit_orb_breakout",
  label: "NQ Reddit ORB Breakout",
  folder: "nasdaq_100_futures_reddit_orb_breakout",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "reddit_orb_breakout",
  liveEnabled: false,
  evaluator: evaluateRedditOrbBreakout,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
