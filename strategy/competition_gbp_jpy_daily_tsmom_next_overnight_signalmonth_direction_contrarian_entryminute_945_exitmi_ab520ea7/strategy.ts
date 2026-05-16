import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_gbp_jpy_daily_tsmom_next_overnight_signalmonth_direction_contrarian_entryminute_945_exitmi_ab520ea7",
  label: "Competition GBPJPY Daily Tsmom Next Overnight Signalmonth",
  folder: "competition_gbp_jpy_daily_tsmom_next_overnight_signalmonth_direction_contrarian_entryminute_945_exitmi_ab520ea7",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
