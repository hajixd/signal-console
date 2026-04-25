import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditEmaPullback } from "@/lib/strategy-runtime/reddit-ema-pullback";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "nasdaq_100_futures_reddit_ema_pullback",
  label: "NQ Reddit EMA Pullback Trend",
  folder: "nasdaq_100_futures_reddit_ema_pullback",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "reddit_ema_pullback",
  liveEnabled: false,
  evaluator: evaluateRedditEmaPullback,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
