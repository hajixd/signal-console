import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_sp_500_futures_us_first30_last30_reversal_weekday_side_0_long_2b2acc93",
  label: "ES US opening-range reversal into the close (Monday longs)",
  folder: "competition_sp_500_futures_us_first30_last30_reversal_weekday_side_0_long_2b2acc93",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "sp_500_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
