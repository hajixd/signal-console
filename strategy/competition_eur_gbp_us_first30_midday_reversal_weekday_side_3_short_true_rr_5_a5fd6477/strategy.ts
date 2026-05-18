import { createStrategyDefinition, runtimeDefaultsFromMetadata } from "@/lib/strategy-definition";
import { evaluateCompetitionSessionEdge } from "@/lib/strategy-runtime/competition-session-edge";
import selection from "./machine_learning/selection.json";

export default createStrategyDefinition({
  id: "competition_eur_gbp_us_first30_midday_reversal_weekday_side_3_short_true_rr_5_a5fd6477",
  label: "EURGBP EURGBP US first30 midday reversal Wednesday shorts true 5R",
  folder: "competition_eur_gbp_us_first30_midday_reversal_weekday_side_3_short_true_rr_5_a5fd6477",
  fileName: "strategy.ts",
  backtestFileName: "backtest_trades.csv",
  assetKey: "eur_gbp",
  phase: "competition_session_edge",
  liveEnabled: true,
  evaluator: evaluateCompetitionSessionEdge,
  defaults: runtimeDefaultsFromMetadata(selection)
});
