import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_aud_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_a3a7f703",
  label: "Competition AUDUSD Us First30 Last30 Reversal Signalmonth",
  folder: "competition_aud_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_a3a7f703",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "aud_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
