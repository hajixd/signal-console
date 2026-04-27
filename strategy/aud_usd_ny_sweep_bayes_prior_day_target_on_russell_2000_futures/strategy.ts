import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "aud_usd_ny_sweep_bayes_prior_day_target_on_russell_2000_futures",
  label: "AUD/USD NY Sweep Bayes Prior-Day Target on Russell 2000 Futures",
  folder: "aud_usd_ny_sweep_bayes_prior_day_target_on_russell_2000_futures",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "russell_2000_futures",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
