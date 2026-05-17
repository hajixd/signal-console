import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_jpy_us_first30_last30_reversal_signalweekdayside_direction_opposite_entryminute_930_ex_40e6d9ae",
  label: "USDJPY US opening-range reversal into the close (Wednesday longs)",
  folder: "competition_usd_jpy_us_first30_last30_reversal_signalweekdayside_direction_opposite_entryminute_930_ex_40e6d9ae",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
