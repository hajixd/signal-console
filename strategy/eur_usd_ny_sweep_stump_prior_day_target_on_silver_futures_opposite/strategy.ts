import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "eur_usd_ny_sweep_stump_prior_day_target_on_silver_futures_opposite",
  label: "EUR/USD NY Sweep Stump Prior-Day Target on Silver Futures Opposite",
  folder: "eur_usd_ny_sweep_stump_prior_day_target_on_silver_futures_opposite",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "silver_futures",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
