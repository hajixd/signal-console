import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_nzd_usd_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitminute_9_183b1d88",
  label: "NZDUSD 10-day daily mean reversion into RTH (February filter)",
  folder: "competition_nzd_usd_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitminute_9_183b1d88",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nzd_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
