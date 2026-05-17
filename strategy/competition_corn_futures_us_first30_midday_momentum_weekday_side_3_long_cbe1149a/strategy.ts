import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_corn_futures_us_first30_midday_momentum_weekday_side_3_long_cbe1149a",
  label: "ZC US opening-range continuation into midday (Thursday longs)",
  folder: "competition_corn_futures_us_first30_midday_momentum_weekday_side_3_long_cbe1149a",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "corn_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
