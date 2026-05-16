import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_gbp_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_3c977a82",
  label: "Competition EURGBP Us First30 Last30 Reversal Signalmonth",
  folder: "competition_eur_gbp_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_3c977a82",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_gbp",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
