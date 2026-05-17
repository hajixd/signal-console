import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_russell_2000_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarmi_801e97d2",
  label: "RTY NY open gap fade (February filter)",
  folder: "competition_russell_2000_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarmi_801e97d2",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "russell_2000_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
