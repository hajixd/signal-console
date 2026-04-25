import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateNySweepPlaybook } from "@/lib/strategy-runtime/ny-sweep-playbook";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "eur_usd_ny_sweep_logit_on_euro_futures",
  label: "EUR/USD NY Sweep V4 Logit on Euro Futures",
  folder: "eur_usd_ny_sweep_logit_on_euro_futures",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "euro_futures",
  phase: "ny_sweep_playbook",
  liveEnabled: true,
  evaluator: evaluateNySweepPlaybook,
  defaults: runtimeDefaultsFromMetadata(selection)
});
