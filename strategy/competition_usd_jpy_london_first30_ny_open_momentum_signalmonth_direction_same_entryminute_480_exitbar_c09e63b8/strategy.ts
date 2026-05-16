import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_jpy_london_first30_ny_open_momentum_signalmonth_direction_same_entryminute_480_exitbar_c09e63b8",
  label: "Competition USDJPY London First30 Ny Open Momentum Signalmonth",
  folder: "competition_usd_jpy_london_first30_ny_open_momentum_signalmonth_direction_same_entryminute_480_exitbar_c09e63b8",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
