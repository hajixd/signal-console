import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_british_pound_futures_us_first30_last30_reversal_month_10_57755118",
  label: "6B US opening-range reversal into the close (October filter)",
  folder: "competition_british_pound_futures_us_first30_last30_reversal_month_10_57755118",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "british_pound_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
