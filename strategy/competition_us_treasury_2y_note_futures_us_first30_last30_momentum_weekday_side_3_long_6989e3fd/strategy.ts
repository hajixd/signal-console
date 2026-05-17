import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_us_treasury_2y_note_futures_us_first30_last30_momentum_weekday_side_3_long_6989e3fd",
  label: "ZT US opening-range continuation into the close (Thursday longs)",
  folder: "competition_us_treasury_2y_note_futures_us_first30_last30_momentum_weekday_side_3_long_6989e3fd",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "us_treasury_2y_note_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
