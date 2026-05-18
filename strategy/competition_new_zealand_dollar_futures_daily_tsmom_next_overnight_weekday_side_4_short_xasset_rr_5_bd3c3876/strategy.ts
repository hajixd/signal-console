import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_new_zealand_dollar_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_bd3c3876",
  label: "6N cross-asset 5-day daily mean reversion overnight (Friday shorts true 5R) true 5R",
  folder: "competition_new_zealand_dollar_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_bd3c3876",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "new_zealand_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
