import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_jpy_daily_tsmom_next_overnight_weekday_side_2_short_true_rr_3_40484fa0",
  label: "USDJPY Daily Tsmom Next Overnight Tuesday shorts true 3R",
  folder: "competition_usd_jpy_daily_tsmom_next_overnight_weekday_side_2_short_true_rr_3_40484fa0",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
