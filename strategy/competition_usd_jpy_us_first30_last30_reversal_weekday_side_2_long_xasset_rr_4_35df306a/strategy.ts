import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_jpy_us_first30_last30_reversal_weekday_side_2_long_xasset_rr_4_35df306a",
  label: "USDJPY cross-asset US opening-range reversal into the close (Wednesday longs) true 4R",
  folder: "competition_usd_jpy_us_first30_last30_reversal_weekday_side_2_long_xasset_rr_4_35df306a",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
