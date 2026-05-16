import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_micro_bitcoin_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminut_30bfc032",
  label: "Competition MBT Daily Tsmom Next Overnight Signalmonth",
  folder: "competition_micro_bitcoin_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminut_30bfc032",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "micro_bitcoin_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
