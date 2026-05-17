import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_us_treasury_10y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_7240deca",
  label: "ZN 20-day daily mean reversion overnight (Friday shorts)",
  folder: "competition_us_treasury_10y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_7240deca",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "us_treasury_10y_note_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
