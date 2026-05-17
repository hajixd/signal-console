import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_0_long_157ef9f4",
  label: "ZB 3-day daily momentum overnight (Monday longs)",
  folder: "competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_0_long_157ef9f4",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "us_treasury_30y_bond_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
