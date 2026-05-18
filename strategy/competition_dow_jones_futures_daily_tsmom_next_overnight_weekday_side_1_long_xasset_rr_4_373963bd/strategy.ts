import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_1_long_xasset_rr_4_373963bd",
  label: "YM cross-asset 20-day daily mean reversion overnight (Tuesday longs) true 4R",
  folder: "competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_1_long_xasset_rr_4_373963bd",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "dow_jones_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
