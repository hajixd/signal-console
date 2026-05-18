import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_japanese_yen_futures_london_first30_ny_open_reversal_month_9_6d9e482f",
  label: "6J London opening-range reversal into New York (August true 5R)",
  folder: "competition_japanese_yen_futures_london_first30_ny_open_reversal_month_9_6d9e482f",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "japanese_yen_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
