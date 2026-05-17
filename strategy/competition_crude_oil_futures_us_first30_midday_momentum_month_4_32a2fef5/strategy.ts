import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_crude_oil_futures_us_first30_midday_momentum_month_4_32a2fef5",
  label: "CL US opening-range continuation into midday (April filter)",
  folder: "competition_crude_oil_futures_us_first30_midday_momentum_month_4_32a2fef5",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "crude_oil_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
