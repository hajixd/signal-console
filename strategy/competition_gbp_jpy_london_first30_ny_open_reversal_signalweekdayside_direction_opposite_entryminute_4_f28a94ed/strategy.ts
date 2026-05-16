import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_gbp_jpy_london_first30_ny_open_reversal_signalweekdayside_direction_opposite_entryminute_4_f28a94ed",
  label: "Competition GBPJPY London First30 Ny Open Reversal Signalweekdayside",
  folder: "competition_gbp_jpy_london_first30_ny_open_reversal_signalweekdayside_direction_opposite_entryminute_4_f28a94ed",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
