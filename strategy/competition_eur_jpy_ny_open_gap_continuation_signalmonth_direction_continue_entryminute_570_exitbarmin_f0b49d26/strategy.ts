import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_jpy_ny_open_gap_continuation_signalmonth_direction_continue_entryminute_570_exitbarmin_f0b49d26",
  label: "Competition EURJPY Ny Open Gap Continuation Signalmonth",
  folder: "competition_eur_jpy_ny_open_gap_continuation_signalmonth_direction_continue_entryminute_570_exitbarmin_f0b49d26",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
