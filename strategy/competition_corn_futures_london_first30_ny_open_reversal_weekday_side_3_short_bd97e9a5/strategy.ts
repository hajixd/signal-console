import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_corn_futures_london_first30_ny_open_reversal_weekday_side_3_short_bd97e9a5",
  label: "ZC London opening-range reversal into New York (Thursday shorts)",
  folder: "competition_corn_futures_london_first30_ny_open_reversal_weekday_side_3_short_bd97e9a5",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "corn_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
