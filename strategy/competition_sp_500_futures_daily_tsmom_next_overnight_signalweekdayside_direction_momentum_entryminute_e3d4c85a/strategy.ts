import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_sp_500_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entryminute_e3d4c85a",
  label: "Competition ES Daily Tsmom Next Overnight Signalweekdayside",
  folder: "competition_sp_500_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entryminute_e3d4c85a",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "sp_500_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
