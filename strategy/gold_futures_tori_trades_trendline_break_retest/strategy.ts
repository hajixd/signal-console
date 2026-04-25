import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateToriTrendlineMtf } from "@/lib/strategy-runtime/tori-trendline-mtf";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "gold_futures_tori_trades_trendline_break_retest",
  label: "GC Tori Trades Trendline Break Retest",
  folder: "gold_futures_tori_trades_trendline_break_retest",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_futures",
  phase: "tori_trendline_mtf",
  liveEnabled: false,
  evaluator: evaluateToriTrendlineMtf,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
