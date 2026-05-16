import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_euro_futures_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitmin_0b54da46",
  label: "Competition 6E Daily Tsmom Next Rth Signalmonth",
  folder: "competition_euro_futures_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitmin_0b54da46",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "euro_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
