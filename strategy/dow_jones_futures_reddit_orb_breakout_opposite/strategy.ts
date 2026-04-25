import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditOrbBreakout } from "@/lib/strategy-runtime/reddit-orb-breakout";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "dow_jones_futures_reddit_orb_breakout_opposite",
  label: "YM Reddit ORB Breakout Opposite",
  folder: "dow_jones_futures_reddit_orb_breakout_opposite",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "dow_jones_futures",
  phase: "reddit_orb_breakout",
  liveEnabled: true,
  evaluator: evaluateRedditOrbBreakout,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
