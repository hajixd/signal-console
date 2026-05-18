import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_australian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_4fbf7cea",
  label: "6A cross-asset cross-asset London opening-range continuation into New York (Monday shorts) true 5R true 5R",
  folder: "competition_australian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_4fbf7cea",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "australian_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
