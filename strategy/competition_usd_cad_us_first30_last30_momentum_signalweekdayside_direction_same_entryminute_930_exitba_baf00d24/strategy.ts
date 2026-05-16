import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_cad_us_first30_last30_momentum_signalweekdayside_direction_same_entryminute_930_exitba_baf00d24",
  label: "Competition USDCAD Us First30 Last30 Momentum Signalweekdayside",
  folder: "competition_usd_cad_us_first30_last30_momentum_signalweekdayside_direction_same_entryminute_930_exitba_baf00d24",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_cad",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
