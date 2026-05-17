import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_nasdaq_100_futures_london_first30_ny_open_momentum_weekday_side_3_short_726e6c71",
  label: "NQ London opening-range continuation into New York (Thursday shorts)",
  folder: "competition_nasdaq_100_futures_london_first30_ny_open_momentum_weekday_side_3_short_726e6c71",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
