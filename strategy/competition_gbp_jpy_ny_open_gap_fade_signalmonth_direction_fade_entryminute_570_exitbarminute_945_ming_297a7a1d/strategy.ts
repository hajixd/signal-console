import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_gbp_jpy_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_945_ming_297a7a1d",
  label: "Competition GBPJPY Ny Open Gap Fade Signalmonth",
  folder: "competition_gbp_jpy_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_945_ming_297a7a1d",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
