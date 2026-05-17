import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_micro_bitcoin_futures_daily_tsmom_next_rth_weekday_side_2_short_4be5774f",
  label: "MBT 10-day daily momentum into RTH (Wednesday shorts)",
  folder: "competition_micro_bitcoin_futures_daily_tsmom_next_rth_weekday_side_2_short_4be5774f",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "micro_bitcoin_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
