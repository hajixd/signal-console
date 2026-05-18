import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_cad_us_first30_last30_momentum_signalmonth_month_3_true_rr_5_08845764",
  label: "USDCAD USDCAD March US first30 last30 momentum true 5R",
  folder: "competition_usd_cad_us_first30_last30_momentum_signalmonth_month_3_true_rr_5_08845764",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_cad",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
