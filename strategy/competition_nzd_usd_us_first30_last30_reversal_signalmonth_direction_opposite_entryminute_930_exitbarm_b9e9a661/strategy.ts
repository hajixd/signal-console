import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_nzd_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_b9e9a661",
  label: "Competition NZDUSD Us First30 Last30 Reversal Signalmonth",
  folder: "competition_nzd_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_b9e9a661",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nzd_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
