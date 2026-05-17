import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f",
  label: "AUDNZD 5-day daily mean reversion overnight (Friday longs)",
  folder: "competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "aud_nzd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
