import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_cad_daily_tsmom_next_rth_signalweekday_direction_contrarian_entryminute_570_exitminute_a84ebf95",
  label: "Competition EURCAD Daily Tsmom Next Rth Signalweekday",
  folder: "competition_eur_cad_daily_tsmom_next_rth_signalweekday_direction_contrarian_entryminute_570_exitminute_a84ebf95",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_cad",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
