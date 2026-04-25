import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditOrbBreakout } from "@/lib/strategy-runtime/reddit-orb-breakout";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "crude_oil_futures_reddit_orb_breakout",
  label: "CL Reddit ORB Breakout",
  folder: "crude_oil_futures_reddit_orb_breakout",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "crude_oil_futures",
  phase: "reddit_orb_breakout",
  liveEnabled: false,
  evaluator: evaluateRedditOrbBreakout,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
