import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_gold_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entryminute_9_c8e1caae",
  label: "Competition GC Daily Tsmom Next Overnight Signalweekdayside",
  folder: "competition_gold_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entryminute_9_c8e1caae",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
