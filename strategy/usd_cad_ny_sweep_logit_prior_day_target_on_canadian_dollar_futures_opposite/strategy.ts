import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "usd_cad_ny_sweep_logit_prior_day_target_on_canadian_dollar_futures_opposite",
  label: "USD/CAD NY Sweep Logit Prior-Day Target on Canadian Dollar Futures Opposite",
  folder: "usd_cad_ny_sweep_logit_prior_day_target_on_canadian_dollar_futures_opposite",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "canadian_dollar_futures",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
