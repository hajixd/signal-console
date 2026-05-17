import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_crude_oil_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exit_ny_o_315d7644",
  label: "CL overnight long close-to-open bias (January filter)",
  folder: "competition_crude_oil_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exit_ny_o_315d7644",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "crude_oil_futures",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
