import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_dow_jones_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_3d9679eb",
  label: "YM cross-asset cross-asset USDCAD March US first30 last30 momentum true 5R true 5R",
  folder: "competition_dow_jones_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_3d9679eb",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "dow_jones_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
