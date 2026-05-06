import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateDecileForwardEdge } from "@/lib/strategy-runtime/decile-forward-edge";
import parameters from "./parameters/backtest.json";

export default createStrategyDefinition({
  id: "nasdaq_100_futures_decile_forward_edge_5m",
  label: "NQ 5m Decile Forward Edge",
  folder: "nasdaq_100_futures_decile_forward_edge_5m",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "nasdaq_100_futures",
  phase: "decile_forward_edge",
  liveEnabled: false,
  evaluator: evaluateDecileForwardEdge,
  defaults: runtimeDefaultsFromMetadata(parameters)
});
