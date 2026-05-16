import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_us_treasury_2y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_339e7451",
  label: "Competition ZT Us First30 Last30 Momentum Signalweekdayside",
  folder: "competition_us_treasury_2y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_339e7451",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "us_treasury_2y_note_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
