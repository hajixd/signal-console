import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_jpy_london_first30_last30_momentum_weekday_side_4_long_xasset_rr_5_1d1c682f",
  label: "USDJPY cross-asset London opening-range continuation into the US close (Friday longs) true 5R",
  folder: "competition_usd_jpy_london_first30_last30_momentum_weekday_side_4_long_xasset_rr_5_1d1c682f",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
