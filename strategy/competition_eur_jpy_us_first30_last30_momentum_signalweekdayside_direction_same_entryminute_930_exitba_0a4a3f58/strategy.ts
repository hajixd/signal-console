import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_jpy_us_first30_last30_momentum_signalweekdayside_direction_same_entryminute_930_exitba_0a4a3f58",
  label: "Competition EURJPY Us First30 Last30 Momentum Signalweekdayside",
  folder: "competition_eur_jpy_us_first30_last30_momentum_signalweekdayside_direction_same_entryminute_930_exitba_0a4a3f58",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
