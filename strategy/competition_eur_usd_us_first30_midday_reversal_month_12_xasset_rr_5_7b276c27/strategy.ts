import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_usd_us_first30_midday_reversal_month_12_xasset_rr_5_7b276c27",
  label: "EURUSD cross-asset USDCAD December US first30 midday reversal true 5R",
  folder: "competition_eur_usd_us_first30_midday_reversal_month_12_xasset_rr_5_7b276c27",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
