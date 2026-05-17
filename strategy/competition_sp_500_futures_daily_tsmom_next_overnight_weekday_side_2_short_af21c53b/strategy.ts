import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_sp_500_futures_daily_tsmom_next_overnight_weekday_side_2_short_af21c53b",
  label: "ES 20-day daily momentum overnight (Wednesday shorts)",
  folder: "competition_sp_500_futures_daily_tsmom_next_overnight_weekday_side_2_short_af21c53b",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "sp_500_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
