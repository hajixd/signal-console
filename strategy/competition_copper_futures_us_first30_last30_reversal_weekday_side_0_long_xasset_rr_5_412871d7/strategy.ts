import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_copper_futures_us_first30_last30_reversal_weekday_side_0_long_xasset_rr_5_412871d7",
  label: "HG cross-asset US opening-range reversal into the close (Monday longs) true 5R",
  folder: "competition_copper_futures_us_first30_last30_reversal_weekday_side_0_long_xasset_rr_5_412871d7",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "copper_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
