import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_chf_daily_tsmom_next_overnight_weekday_side_2_short_15ab1798",
  label: "EURCHF 20-day daily mean reversion overnight (Wednesday shorts)",
  folder: "competition_eur_chf_daily_tsmom_next_overnight_weekday_side_2_short_15ab1798",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_chf",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
