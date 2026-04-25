import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "gbp_usd_ny_sweep_bayes_prior_day_target_on_sp_500_futures",
  label: "GBP/USD NY Sweep Bayes Prior-Day Target on S&P 500 Futures",
  folder: "gbp_usd_ny_sweep_bayes_prior_day_target_on_sp_500_futures",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "sp_500_futures",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
