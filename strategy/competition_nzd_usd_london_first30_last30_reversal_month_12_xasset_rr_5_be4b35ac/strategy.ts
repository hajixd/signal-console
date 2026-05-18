import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_nzd_usd_london_first30_last30_reversal_month_12_xasset_rr_5_be4b35ac",
  label: "NZDUSD cross-asset GBPUSD London first30 last30 December reversal true 5R",
  folder: "competition_nzd_usd_london_first30_last30_reversal_month_12_xasset_rr_5_be4b35ac",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nzd_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
