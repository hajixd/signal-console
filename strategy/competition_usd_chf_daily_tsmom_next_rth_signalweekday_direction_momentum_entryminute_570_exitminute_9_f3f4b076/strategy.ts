import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_chf_daily_tsmom_next_rth_signalweekday_direction_momentum_entryminute_570_exitminute_9_f3f4b076",
  label: "Competition USDCHF Daily Tsmom Next Rth Signalweekday",
  folder: "competition_usd_chf_daily_tsmom_next_rth_signalweekday_direction_momentum_entryminute_570_exitminute_9_f3f4b076",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_chf",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
