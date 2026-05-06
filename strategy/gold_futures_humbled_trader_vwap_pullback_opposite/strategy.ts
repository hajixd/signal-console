import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateVwapPullback } from "@/lib/strategy-runtime/vwap-pullback";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "gold_futures_humbled_trader_vwap_pullback_opposite",
  label: "GC Humbled Trader VWAP Pullback Opposite",
  folder: "gold_futures_humbled_trader_vwap_pullback_opposite",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gold_futures",
  phase: "vwap_pullback",
  liveEnabled: true,
  evaluator: evaluateVwapPullback,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
