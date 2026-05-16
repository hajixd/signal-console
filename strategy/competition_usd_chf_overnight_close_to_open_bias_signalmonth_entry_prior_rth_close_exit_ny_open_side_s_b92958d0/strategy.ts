import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_usd_chf_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exit_ny_open_side_s_b92958d0",
  label: "Competition USDCHF Overnight Close To Open Bias Signalmonth",
  folder: "competition_usd_chf_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exit_ny_open_side_s_b92958d0",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_chf",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
