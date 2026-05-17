import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_1aa4fa28",
  label: "6A NY open gap fade (October filter)",
  folder: "competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_1aa4fa28",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "australian_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
