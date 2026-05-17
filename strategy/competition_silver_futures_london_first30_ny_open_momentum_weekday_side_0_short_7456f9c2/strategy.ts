import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_silver_futures_london_first30_ny_open_momentum_weekday_side_0_short_7456f9c2",
  label: "SI London opening-range continuation into New York (Monday shorts)",
  folder: "competition_silver_futures_london_first30_ny_open_momentum_weekday_side_0_short_7456f9c2",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "silver_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
