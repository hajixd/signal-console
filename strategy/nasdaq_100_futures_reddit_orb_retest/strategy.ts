import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditOrbRetest } from "@/lib/strategy-runtime/reddit-orb-retest";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "nasdaq_100_futures_reddit_orb_retest",
  label: "NQ Reddit ORB Retest Breakout",
  folder: "nasdaq_100_futures_reddit_orb_retest",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "reddit_orb_retest",
  liveEnabled: true,
  evaluator: evaluateRedditOrbRetest,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
