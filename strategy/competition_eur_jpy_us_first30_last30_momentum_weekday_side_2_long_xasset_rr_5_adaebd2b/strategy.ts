import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_jpy_us_first30_last30_momentum_weekday_side_2_long_xasset_rr_5_adaebd2b",
  label: "EURJPY cross-asset US opening-range continuation into the close (Wednesday longs) true 5R",
  folder: "competition_eur_jpy_us_first30_last30_momentum_weekday_side_2_long_xasset_rr_5_adaebd2b",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
