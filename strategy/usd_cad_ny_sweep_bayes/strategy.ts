import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "usd_cad_ny_sweep_bayes",
  label: "USD/CAD NY Sweep V4 Naive Bayes",
  folder: "usd_cad_ny_sweep_bayes",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "usd_cad",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
