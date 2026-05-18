import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_canadian_dollar_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_384613a9",
  label: "6C cross-asset cross-asset USDCAD March US first30 last30 momentum true 5R true 5R",
  folder: "competition_canadian_dollar_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_384613a9",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "canadian_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
