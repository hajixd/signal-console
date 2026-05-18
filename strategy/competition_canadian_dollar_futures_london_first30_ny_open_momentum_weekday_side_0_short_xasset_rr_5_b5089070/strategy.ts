import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_canadian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_b5089070",
  label: "6C cross-asset cross-asset London opening-range continuation into New York (Monday shorts) true 5R true 5R",
  folder: "competition_canadian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_b5089070",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "canadian_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
