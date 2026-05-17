import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_gbp_london_first30_ny_open_reversal_weekday_side_4_long_97b8e7c1",
  label: "EURGBP London opening-range reversal into New York (Friday longs)",
  folder: "competition_eur_gbp_london_first30_ny_open_reversal_weekday_side_4_long_97b8e7c1",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_gbp",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
