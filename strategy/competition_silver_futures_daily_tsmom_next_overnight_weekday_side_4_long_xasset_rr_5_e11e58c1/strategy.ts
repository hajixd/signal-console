import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_silver_futures_daily_tsmom_next_overnight_weekday_side_4_long_xasset_rr_5_e11e58c1",
  label: "SI cross-asset 20-day daily momentum overnight (Friday longs) true 5R",
  folder: "competition_silver_futures_daily_tsmom_next_overnight_weekday_side_4_long_xasset_rr_5_e11e58c1",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "silver_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
