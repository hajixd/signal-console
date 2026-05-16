import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_jpy_london_first30_ny_open_momentum_signalweekdayside_direction_same_entryminute_480_e_ce191581",
  label: "Competition USDJPY London First30 Ny Open Momentum Signalweekdayside",
  folder: "competition_usd_jpy_london_first30_ny_open_momentum_signalweekdayside_direction_same_entryminute_480_e_ce191581",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
