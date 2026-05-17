import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_japanese_yen_futures_overnight_close_to_open_bias_short_month_10_6bc43a25",
  label: "6J overnight short close-to-open bias (October filter)",
  folder: "competition_japanese_yen_futures_overnight_close_to_open_bias_short_month_10_6bc43a25",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "japanese_yen_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
