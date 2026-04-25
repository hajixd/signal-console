import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "gbp_usd_ny_sweep_bayes",
  label: "GBP/USD NY Sweep V4 Naive Bayes",
  folder: "gbp_usd_ny_sweep_bayes",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_usd",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
