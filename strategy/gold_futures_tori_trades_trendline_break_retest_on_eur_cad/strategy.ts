import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateToriTrendlineMtf } from "@/lib/strategy-runtime/tori-trendline-mtf";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "gold_futures_tori_trades_trendline_break_retest_on_eur_cad",
  label: "GC Tori Trades Trendline Break Retest on EUR/CAD",
  folder: "gold_futures_tori_trades_trendline_break_retest_on_eur_cad",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_cad",
  phase: "tori_trendline_mtf",
  liveEnabled: true,
  evaluator: evaluateToriTrendlineMtf,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
