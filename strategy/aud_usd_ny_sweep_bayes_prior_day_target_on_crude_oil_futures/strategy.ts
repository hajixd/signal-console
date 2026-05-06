import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "aud_usd_ny_sweep_bayes_prior_day_target_on_crude_oil_futures",
  label: "AUD/USD NY Sweep Bayes Prior-Day Target on Crude Oil Futures",
  folder: "aud_usd_ny_sweep_bayes_prior_day_target_on_crude_oil_futures",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "crude_oil_futures",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
