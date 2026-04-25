import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditOrbBreakout } from "@/lib/strategy-runtime/reddit-orb-breakout";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "sp_500_futures_reddit_orb_breakout",
  label: "ES Reddit ORB Breakout",
  folder: "sp_500_futures_reddit_orb_breakout",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "sp_500_futures",
  phase: "reddit_orb_breakout",
  liveEnabled: true,
  evaluator: evaluateRedditOrbBreakout,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
