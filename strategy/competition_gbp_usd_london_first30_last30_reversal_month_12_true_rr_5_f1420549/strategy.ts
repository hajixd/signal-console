import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_gbp_usd_london_first30_last30_reversal_month_12_true_rr_5_f1420549",
  label: "GBPUSD GBPUSD London first30 last30 December reversal true 5R",
  folder: "competition_gbp_usd_london_first30_last30_reversal_month_12_true_rr_5_f1420549",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
