import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5",
  label: "AUDUSD cross-asset US opening-range continuation into the close (September filter) true 5R",
  folder: "competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "aud_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
