import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateToriTrendlineMtf } from "@/lib/strategy-runtime/tori-trendline-mtf";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "gold_futures_tori_trades_trendline_break_retest_on_usd_jpy",
  label: "GC Tori Trades Trendline Break Retest on USD/JPY",
  folder: "gold_futures_tori_trades_trendline_break_retest_on_usd_jpy",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_jpy",
  phase: "tori_trendline_mtf",
  liveEnabled: true,
  evaluator: evaluateToriTrendlineMtf,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
