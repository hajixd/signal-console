import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "usd_jpy_ny_sweep_bayes",
  label: "USD/JPY NY Sweep V4 Naive Bayes",
  folder: "usd_jpy_ny_sweep_bayes",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_jpy",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
