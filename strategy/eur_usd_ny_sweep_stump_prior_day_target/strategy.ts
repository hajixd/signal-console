import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "eur_usd_ny_sweep_stump_prior_day_target",
  label: "EUR/USD NY Sweep Stump Prior-Day Target",
  folder: "eur_usd_ny_sweep_stump_prior_day_target",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_usd",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
