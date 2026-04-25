import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "usd_jpy_ny_sweep_bayes_on_copper_futures",
  label: "USD/JPY NY Sweep V4 Naive Bayes on Copper Futures",
  folder: "usd_jpy_ny_sweep_bayes_on_copper_futures",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "copper_futures",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
