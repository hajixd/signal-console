import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_british_pound_futures_daily_tsmom_next_overnight_month_7_da1c691c",
  label: "6B 3-day daily momentum overnight (July filter)",
  folder: "competition_british_pound_futures_daily_tsmom_next_overnight_month_7_da1c691c",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "british_pound_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
