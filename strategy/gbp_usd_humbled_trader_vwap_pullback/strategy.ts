import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateVwapPullback } from "@/lib/strategy-runtime/vwap-pullback";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "gbp_usd_humbled_trader_vwap_pullback",
  label: "GBP/USD Humbled Trader VWAP Pullback",
  folder: "gbp_usd_humbled_trader_vwap_pullback",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "gbp_usd",
  phase: "vwap_pullback",
  liveEnabled: true,
  evaluator: evaluateVwapPullback,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
