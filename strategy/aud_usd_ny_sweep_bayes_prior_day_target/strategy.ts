import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "aud_usd_ny_sweep_bayes_prior_day_target",
  label: "AUD/USD NY Sweep Bayes Prior-Day Target",
  folder: "aud_usd_ny_sweep_bayes_prior_day_target",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "aud_usd",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
