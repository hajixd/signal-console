import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_aud_nzd_asia_range_london_breakout_signalmonth_breakendminute_360_breakstartminute_180_dir_c8638be4",
  label: "Competition AUDNZD Asia Range London Breakout Signalmonth",
  folder: "competition_aud_nzd_asia_range_london_breakout_signalmonth_breakendminute_360_breakstartminute_180_dir_c8638be4",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "aud_nzd",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
