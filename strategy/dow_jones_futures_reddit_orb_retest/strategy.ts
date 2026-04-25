import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditOrbRetest } from "@/lib/strategy-runtime/reddit-orb-retest";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "dow_jones_futures_reddit_orb_retest",
  label: "YM Reddit ORB Retest Breakout",
  folder: "dow_jones_futures_reddit_orb_retest",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "dow_jones_futures",
  phase: "reddit_orb_retest",
  liveEnabled: false,
  evaluator: evaluateRedditOrbRetest,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
