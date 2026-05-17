import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_us_treasury_2y_note_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_ex_d2289e05",
  label: "ZT NY open gap fade (December filter)",
  folder: "competition_us_treasury_2y_note_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_ex_d2289e05",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "us_treasury_2y_note_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
