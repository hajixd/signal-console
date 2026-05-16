import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_usd_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminute_945_exitminu_3620b57f",
  label: "Competition EURUSD Daily Tsmom Next Overnight Signalmonth",
  folder: "competition_eur_usd_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminute_945_exitminu_3620b57f",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
