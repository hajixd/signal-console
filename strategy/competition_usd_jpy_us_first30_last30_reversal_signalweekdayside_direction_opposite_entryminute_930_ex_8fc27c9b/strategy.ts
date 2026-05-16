import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_jpy_us_first30_last30_reversal_signalweekdayside_direction_opposite_entryminute_930_ex_8fc27c9b",
  label: "Competition USDJPY Us First30 Last30 Reversal Signalweekdayside",
  folder: "competition_usd_jpy_us_first30_last30_reversal_signalweekdayside_direction_opposite_entryminute_930_ex_8fc27c9b",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
