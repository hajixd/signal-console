import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_copper_futures_london_first30_last30_reversal_month_1_xasset_rr_5_d91f5efb",
  label: "HG cross-asset London opening-range reversal into the US close (January filter) true 5R",
  folder: "competition_copper_futures_london_first30_last30_reversal_month_1_xasset_rr_5_d91f5efb",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "copper_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
