import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_japanese_yen_futures_daily_tsmom_next_rth_signalweekdayside_direction_contrarian_entryminu_43aa3fbc",
  label: "Competition 6J Daily Tsmom Next Rth Signalweekdayside",
  folder: "competition_japanese_yen_futures_daily_tsmom_next_rth_signalweekdayside_direction_contrarian_entryminu_43aa3fbc",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "japanese_yen_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
