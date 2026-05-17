import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_swiss_franc_futures_us_first30_midday_momentum_month_5_a2abc7dd",
  label: "6S US opening-range continuation into midday (May filter)",
  folder: "competition_swiss_franc_futures_us_first30_midday_momentum_month_5_a2abc7dd",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "swiss_franc_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
