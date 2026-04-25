import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateTrendlineBreak } from "@/lib/strategy-runtime/trendline-break";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "crude_oil_futures_tori_trades_trendline_break_retest",
  label: "CL Tori Trades Trendline Break Retest",
  folder: "crude_oil_futures_tori_trades_trendline_break_retest",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "crude_oil_futures",
  phase: "trendline_break",
  liveEnabled: false,
  evaluator: evaluateTrendlineBreak,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
