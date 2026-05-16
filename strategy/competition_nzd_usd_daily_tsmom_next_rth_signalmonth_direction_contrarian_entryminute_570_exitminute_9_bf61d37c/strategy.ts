import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_nzd_usd_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitminute_9_bf61d37c",
  label: "Competition NZDUSD Daily Tsmom Next Rth Signalmonth",
  folder: "competition_nzd_usd_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitminute_9_bf61d37c",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nzd_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
