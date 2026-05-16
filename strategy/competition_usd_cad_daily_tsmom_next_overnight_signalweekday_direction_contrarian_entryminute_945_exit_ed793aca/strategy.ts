import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_cad_daily_tsmom_next_overnight_signalweekday_direction_contrarian_entryminute_945_exit_ed793aca",
  label: "Competition USDCAD Daily Tsmom Next Overnight Signalweekday",
  folder: "competition_usd_cad_daily_tsmom_next_overnight_signalweekday_direction_contrarian_entryminute_945_exit_ed793aca",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_cad",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
