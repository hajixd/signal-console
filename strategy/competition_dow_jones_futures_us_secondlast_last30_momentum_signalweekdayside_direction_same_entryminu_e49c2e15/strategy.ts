import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_dow_jones_futures_us_secondlast_last30_momentum_signalweekdayside_direction_same_entryminu_e49c2e15",
  label: "Competition YM Us Secondlast Last30 Momentum Signalweekdayside",
  folder: "competition_dow_jones_futures_us_secondlast_last30_momentum_signalweekdayside_direction_same_entryminu_e49c2e15",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "dow_jones_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
