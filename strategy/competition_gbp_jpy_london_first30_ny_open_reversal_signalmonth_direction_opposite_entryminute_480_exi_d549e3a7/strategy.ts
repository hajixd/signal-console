import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_gbp_jpy_london_first30_ny_open_reversal_signalmonth_direction_opposite_entryminute_480_exi_d549e3a7",
  label: "GBPJPY London opening-range reversal into New York (June filter)",
  folder: "competition_gbp_jpy_london_first30_ny_open_reversal_signalmonth_direction_opposite_entryminute_480_exi_d549e3a7",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
