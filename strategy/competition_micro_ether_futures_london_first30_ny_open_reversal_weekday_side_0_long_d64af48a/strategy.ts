import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_micro_ether_futures_london_first30_ny_open_reversal_weekday_side_0_long_d64af48a",
  label: "MET London opening-range reversal into New York (Monday longs)",
  folder: "competition_micro_ether_futures_london_first30_ny_open_reversal_weekday_side_0_long_d64af48a",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "micro_ether_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
