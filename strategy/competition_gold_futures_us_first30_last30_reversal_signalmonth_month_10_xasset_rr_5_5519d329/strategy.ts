import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_gold_futures_us_first30_last30_reversal_signalmonth_month_10_xasset_rr_5_5519d329",
  label: "GC cross-asset cross-asset cross-asset US opening-range reversal into the close (October true 5R) true 5R true 5R",
  folder: "competition_gold_futures_us_first30_last30_reversal_signalmonth_month_10_xasset_rr_5_5519d329",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
