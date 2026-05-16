import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_us_treasury_5y_note_futures_daily_tsmom_next_rth_signalweekdayside_direction_momentum_entr_b5f85504",
  label: "Competition ZF Daily Tsmom Next Rth Signalweekdayside",
  folder: "competition_us_treasury_5y_note_futures_daily_tsmom_next_rth_signalweekdayside_direction_momentum_entr_b5f85504",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "us_treasury_5y_note_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
