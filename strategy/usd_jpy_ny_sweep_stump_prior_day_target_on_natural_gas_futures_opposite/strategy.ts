import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "usd_jpy_ny_sweep_stump_prior_day_target_on_natural_gas_futures_opposite",
  label: "USD/JPY NY Sweep Stump Prior-Day Target on Natural Gas Futures Opposite",
  folder: "usd_jpy_ny_sweep_stump_prior_day_target_on_natural_gas_futures_opposite",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "natural_gas_futures",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
