import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_new_zealand_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entry_ce284576",
  label: "6N US opening-range reversal into the close (December filter)",
  folder: "competition_new_zealand_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entry_ce284576",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "new_zealand_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
