import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateIctTurtleSoup } from "@/lib/strategy-runtime/ict-turtle-soup";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "gbp_usd_ict_turtle_soup",
  label: "GBP/USD Research-Based ICT Turtle Soup Reversal",
  folder: "gbp_usd_ict_turtle_soup",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_usd",
  phase: "ict_turtle_soup",
  liveEnabled: false,
  evaluator: evaluateIctTurtleSoup,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
