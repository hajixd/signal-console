import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateRedditEmaPullback } from "@/lib/strategy-runtime/reddit-ema-pullback";
import parameters from "./parameters/backtest.json";


export default createStrategyDefinition({

  id: "dow_jones_futures_reddit_ema_pullback",

  label: "YM Reddit EMA Pullback Trend",

  folder: "dow_jones_futures_reddit_ema_pullback",

  fileName: "strategy.ts",

  backtestFileName: "backtest_trades.csv",

  assetKey: "dow_jones_futures",

  phase: "reddit_ema_pullback",

  liveEnabled: true,

  evaluator: evaluateRedditEmaPullback,

  defaults: runtimeDefaultsFromMetadata(parameters)
});
