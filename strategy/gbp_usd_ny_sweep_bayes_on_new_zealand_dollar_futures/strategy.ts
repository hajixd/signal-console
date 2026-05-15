import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "gbp_usd_ny_sweep_bayes_on_new_zealand_dollar_futures",
  label: "GBP/USD NY Sweep V4 Naive Bayes on New Zealand Dollar Futures",
  folder: "gbp_usd_ny_sweep_bayes_on_new_zealand_dollar_futures",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "new_zealand_dollar_futures",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
