import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_jpy_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_563aa3f1",
  label: "Competition EURJPY Daily Tsmom Next Rth Signalmonth",
  folder: "competition_eur_jpy_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_563aa3f1",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
