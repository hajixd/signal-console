import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateToriTrendlineMtf } from "@/lib/strategy-runtime/tori-trendline-mtf";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "gold_futures_tori_trades_trendline_break_retest",
  label: "Gold Futures Tori Trendline Break Retest",
  folder: "gold_futures_tori_trades_trendline_break_retest",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_futures",
  phase: "tori_trendline_mtf",
  liveEnabled: true,
  evaluator: evaluateToriTrendlineMtf,
  defaults: runtimeDefaultsFromMetadata(selection)
});
