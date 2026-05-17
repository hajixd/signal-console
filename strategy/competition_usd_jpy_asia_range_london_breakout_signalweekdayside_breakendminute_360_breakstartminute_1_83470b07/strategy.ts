import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_jpy_asia_range_london_breakout_signalweekdayside_breakendminute_360_breakstartminute_1_83470b07",
  label: "USDJPY Asia range breakout into London (Wednesday longs)",
  folder: "competition_usd_jpy_asia_range_london_breakout_signalweekdayside_breakendminute_360_breakstartminute_1_83470b07",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_jpy",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
