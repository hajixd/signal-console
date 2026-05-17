import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_micro_ether_futures_daily_tsmom_next_overnight_weekday_side_1_long_dc4c34f3",
  label: "MET 3-day daily mean reversion overnight (Tuesday longs)",
  folder: "competition_micro_ether_futures_daily_tsmom_next_overnight_weekday_side_1_long_dc4c34f3",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "micro_ether_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
