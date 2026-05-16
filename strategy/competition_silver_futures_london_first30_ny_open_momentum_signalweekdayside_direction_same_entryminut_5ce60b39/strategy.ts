import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_silver_futures_london_first30_ny_open_momentum_signalweekdayside_direction_same_entryminut_5ce60b39",
  label: "Competition SI London First30 Ny Open Momentum Signalweekdayside",
  folder: "competition_silver_futures_london_first30_ny_open_momentum_signalweekdayside_direction_same_entryminut_5ce60b39",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "silver_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
