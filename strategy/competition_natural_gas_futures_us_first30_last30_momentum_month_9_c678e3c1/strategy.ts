import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_natural_gas_futures_us_first30_last30_momentum_month_9_c678e3c1",
  label: "NG US opening-range continuation into the close (September filter)",
  folder: "competition_natural_gas_futures_us_first30_last30_momentum_month_9_c678e3c1",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "natural_gas_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
