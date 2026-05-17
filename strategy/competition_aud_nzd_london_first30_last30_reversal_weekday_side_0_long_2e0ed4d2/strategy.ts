import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_aud_nzd_london_first30_last30_reversal_weekday_side_0_long_2e0ed4d2",
  label: "AUDNZD London opening-range reversal into the US close (Monday longs)",
  folder: "competition_aud_nzd_london_first30_last30_reversal_weekday_side_0_long_2e0ed4d2",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "aud_nzd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
