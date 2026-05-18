import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_aud_usd_london_first30_ny_open_momentum_signalweekdayside_xasset_rr_4_0208edb7",
  label: "AUDUSD cross-asset London opening-range continuation into New York (Friday longs) true 4R",
  folder: "competition_aud_usd_london_first30_ny_open_momentum_signalweekdayside_xasset_rr_4_0208edb7",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "aud_usd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
