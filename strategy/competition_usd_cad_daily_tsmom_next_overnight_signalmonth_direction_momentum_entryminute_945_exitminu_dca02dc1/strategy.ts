import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_cad_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminute_945_exitminu_dca02dc1",
  label: "Competition USDCAD Daily Tsmom Next Overnight Signalmonth",
  folder: "competition_usd_cad_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminute_945_exitminu_dca02dc1",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_cad",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
