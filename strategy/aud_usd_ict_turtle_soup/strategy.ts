import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateIctTurtleSoup } from "@/lib/strategy-runtime/ict-turtle-soup";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "aud_usd_ict_turtle_soup",
  label: "AUD/USD Research-Based ICT Turtle Soup Reversal",
  folder: "aud_usd_ict_turtle_soup",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "aud_usd",
  phase: "ict_turtle_soup",
  liveEnabled: true,
  evaluator: evaluateIctTurtleSoup,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
