import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_nasdaq_100_futures_daily_tsmom_next_overnight_weekday_side_1_long_8e593f24",
  label: "NQ 20-day daily mean reversion overnight (Tuesday longs)",
  folder: "competition_nasdaq_100_futures_daily_tsmom_next_overnight_weekday_side_1_long_8e593f24",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
