import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_2_short_99ba7153",
  label: "YM 20-day daily momentum overnight (Wednesday shorts)",
  folder: "competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_2_short_99ba7153",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "dow_jones_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
