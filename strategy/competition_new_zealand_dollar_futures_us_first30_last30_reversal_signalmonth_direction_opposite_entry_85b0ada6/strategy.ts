import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_new_zealand_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entry_85b0ada6",
  label: "Competition 6N Us First30 Last30 Reversal Signalmonth",
  folder: "competition_new_zealand_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entry_85b0ada6",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "new_zealand_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
