import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_canadian_dollar_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entrymin_eee85315",
  label: "6C 5-day daily momentum overnight (December filter)",
  folder: "competition_canadian_dollar_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entrymin_eee85315",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "canadian_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
