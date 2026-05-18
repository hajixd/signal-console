import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_jpy_daily_tsmom_next_rth_signalmonth_xasset_rr_5_32a353da",
  label: "EURJPY cross-asset 5-day daily momentum into RTH (February filter) true 5R",
  folder: "competition_eur_jpy_daily_tsmom_next_rth_signalmonth_xasset_rr_5_32a353da",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
