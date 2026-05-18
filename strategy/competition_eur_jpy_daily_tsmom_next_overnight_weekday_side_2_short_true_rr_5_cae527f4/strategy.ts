import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_jpy_daily_tsmom_next_overnight_weekday_side_2_short_true_rr_5_cae527f4",
  label: "EURJPY EURJPY Wednesday short daily TSMOM overnight true 5R",
  folder: "competition_eur_jpy_daily_tsmom_next_overnight_weekday_side_2_short_true_rr_5_cae527f4",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
