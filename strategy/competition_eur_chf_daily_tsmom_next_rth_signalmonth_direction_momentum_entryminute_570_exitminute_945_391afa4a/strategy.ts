import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_chf_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_391afa4a",
  label: "EURCHF 5-day daily momentum into RTH (February filter)",
  folder: "competition_eur_chf_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_391afa4a",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_chf",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
