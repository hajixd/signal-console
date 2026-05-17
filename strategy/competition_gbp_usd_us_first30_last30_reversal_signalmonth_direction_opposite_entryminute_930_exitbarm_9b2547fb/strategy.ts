import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_gbp_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_9b2547fb",
  label: "GBPUSD US opening-range reversal into the close (October filter)",
  folder: "competition_gbp_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_9b2547fb",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
