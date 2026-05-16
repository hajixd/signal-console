import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_canadian_dollar_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exi_31e5e01a",
  label: "Competition 6C Overnight Close To Open Bias Signalmonth",
  folder: "competition_canadian_dollar_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exi_31e5e01a",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "canadian_dollar_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
