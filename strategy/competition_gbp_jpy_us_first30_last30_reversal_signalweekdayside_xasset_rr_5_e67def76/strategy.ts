import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_gbp_jpy_us_first30_last30_reversal_signalweekdayside_xasset_rr_5_e67def76",
  label: "GBPJPY cross-asset US opening-range reversal into the close (Wednesday longs) true 5R",
  folder: "competition_gbp_jpy_us_first30_last30_reversal_signalweekdayside_xasset_rr_5_e67def76",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
