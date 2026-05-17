import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_russell_2000_futures_daily_tsmom_next_overnight_month_7_d15e8a17",
  label: "RTY 10-day daily momentum overnight (July filter)",
  folder: "competition_russell_2000_futures_daily_tsmom_next_overnight_month_7_d15e8a17",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "russell_2000_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
