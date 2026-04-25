import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateTrendlineBreak } from "@/lib/strategy-runtime/trendline-break";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "sp_500_futures_tori_trades_trendline_break_retest",
  label: "ES Tori Trades Trendline Break Retest",
  folder: "sp_500_futures_tori_trades_trendline_break_retest",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "sp_500_futures",
  phase: "trendline_break",
  liveEnabled: true,
  evaluator: evaluateTrendlineBreak,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
