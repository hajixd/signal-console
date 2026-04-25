import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "gbp_usd_ny_sweep_logit",
  label: "GBP/USD NY Sweep V4 Logit",
  folder: "gbp_usd_ny_sweep_logit",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_usd",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
