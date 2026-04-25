import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "usd_jpy_ny_sweep_logit_on_sp_500_futures",
  label: "USD/JPY NY Sweep V4 Logit on S&P 500 Futures",
  folder: "usd_jpy_ny_sweep_logit_on_sp_500_futures",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "sp_500_futures",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
