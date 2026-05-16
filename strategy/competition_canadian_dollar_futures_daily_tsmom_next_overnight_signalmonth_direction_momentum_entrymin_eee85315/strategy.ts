import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_canadian_dollar_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entrymin_eee85315",
  label: "Competition 6C Daily Tsmom Next Overnight Signalmonth",
  folder: "competition_canadian_dollar_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entrymin_eee85315",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "canadian_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
