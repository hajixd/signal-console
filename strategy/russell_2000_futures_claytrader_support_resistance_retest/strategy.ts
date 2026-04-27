import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateSupportResistanceRetest } from "@/lib/strategy-runtime/support-resistance-retest";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "russell_2000_futures_claytrader_support_resistance_retest",
  label: "RTY ClayTrader Support Resistance Retest",
  folder: "russell_2000_futures_claytrader_support_resistance_retest",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "russell_2000_futures",
  phase: "support_resistance_retest",
  liveEnabled: true,
  evaluator: evaluateSupportResistanceRetest,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
