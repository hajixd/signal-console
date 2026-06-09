import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_natural_gas_futures_daily_tsmom_next_overnight_weekday_side_4_long_xasset_rr_5_d44e0dd2",
  label: "NG cross-asset 20-day daily momentum overnight (Friday longs) true 5R",
  folder: "competition_natural_gas_futures_daily_tsmom_next_overnight_weekday_side_4_long_xasset_rr_5_d44e0dd2",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "natural_gas_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
