import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_new_zealand_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exi_7ad85d81",
  label: "6N NY open gap fade (February filter)",
  folder: "competition_new_zealand_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exi_7ad85d81",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "new_zealand_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
