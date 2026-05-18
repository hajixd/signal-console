import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_6a54acc6",
  label: "SI cross-asset US opening-range reversal into the close (December filter) true 5R",
  folder: "competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_6a54acc6",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "silver_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
