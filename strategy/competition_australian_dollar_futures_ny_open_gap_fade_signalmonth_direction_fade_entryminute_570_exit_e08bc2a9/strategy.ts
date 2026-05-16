import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_e08bc2a9",
  label: "Competition 6A Ny Open Gap Fade Signalmonth",
  folder: "competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_e08bc2a9",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "australian_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
