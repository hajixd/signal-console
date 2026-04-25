import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditEmaPullback } from "@/lib/strategy-runtime/reddit-ema-pullback";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "gold_futures_reddit_ema_pullback",

  label: "GC Reddit EMA Pullback Trend",

  folder: "gold_futures_reddit_ema_pullback",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "gold_futures",

  phase: "reddit_ema_pullback",

  liveEnabled: true,

  evaluator: evaluateRedditEmaPullback,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
