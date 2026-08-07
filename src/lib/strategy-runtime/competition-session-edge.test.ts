import assert from "node:assert/strict";
import test from "node:test";
import type { EnrichedBar } from "@/lib/indicators";
import type { StrategyRule } from "@/lib/types";
import { evaluateCompetitionSessionEdge } from "./competition-session-edge";

const rule: StrategyRule = {
  assetKey: "test_futures",
  estimatedWinRatePct: 50,
  key: "multi-speed-test",
  label: "Multi-speed test",
  liveProfitFactor: 1,
  logicalKey: "multi-speed-test",
  market: "futures",
  phase: "competition_session_edge",
  slUnits: 10,
  strategyId: "multi-speed-test",
  symbol: "TEST",
  tickSize: 0.25,
  tpUnits: 20,
  unitLabel: "ticks",
  variantId:
    "competition_session_edge|family=daily_tsmom_next_overnight_consensus_all|consensus=3|direction=momentum|entry=945|exit=570|lookbacks=1,2,3|risk_reward=2"
};

function closeBar(day: number, close: number): EnrichedBar {
  return {
    time: `2026-01-${String(day).padStart(2, "0")}T20:45:00.000Z`,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    atr14: 1,
    nyDate: `2026-01-${String(day).padStart(2, "0")}`,
    nyMinutes: 945,
    nyWeekday: (day - 1) % 5
  } as EnrichedBar;
}

test("multi-speed momentum requires every configured trend speed to agree", () => {
  const aligned = [closeBar(1, 100), closeBar(2, 101), closeBar(3, 102), closeBar(4, 103)];
  const signal = evaluateCompetitionSessionEdge(rule, aligned, aligned.length - 1);
  assert.equal(signal?.side, "long");
  assert.equal(signal?.riskReward, 2);

  const disagreement = [closeBar(1, 100), closeBar(2, 105), closeBar(3, 101), closeBar(4, 103)];
  assert.equal(evaluateCompetitionSessionEdge(rule, disagreement, disagreement.length - 1), null);
});
