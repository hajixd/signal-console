import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_japanese_yen_futures_us_first30_last30_reversal_signalweekdayside_direction_opposite_entry_d778febb",
  label: "Competition 6J Us First30 Last30 Reversal Signalweekdayside",
  folder: "competition_japanese_yen_futures_us_first30_last30_reversal_signalweekdayside_direction_opposite_entry_d778febb",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "japanese_yen_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
