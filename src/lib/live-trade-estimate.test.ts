import assert from "node:assert/strict";
import test from "node:test";
import { liveTradeEstimate } from "./live-trade-estimate";

test("calculates the live estimate for an open futures trade", () => {
  const estimate = liveTradeEstimate({
    dollarsPerPricePoint: 30,
    entryPrice: 4_451.4,
    entryTime: "2026-08-10T19:31:00.000Z",
    markPrice: 4_448.7,
    markTime: "2026-08-10T21:00:00.000Z",
    riskDollars: 246,
    side: "long"
  });

  assert.ok(estimate);
  assert.equal(estimate.pnlDollars, -81);
  assert.equal(estimate.barsHeld, 89);
  assert.equal(estimate.elapsedMinutes, 89);
  assert.equal(estimate.rMultiple?.toFixed(2), "-0.33");
});

test("the same symbol quote respects each row's executed size", () => {
  const common = {
    entryPrice: 6.635,
    entryTime: "2026-08-10T19:15:00.000Z",
    markPrice: 6.6355,
    markTime: "2026-08-10T21:00:00.000Z",
    riskDollars: 250,
    side: "long" as const
  };

  assert.equal(liveTradeEstimate({ ...common, dollarsPerPricePoint: 5_000 })?.pnlDollars, 2.5);
  assert.equal(liveTradeEstimate({ ...common, dollarsPerPricePoint: 25_000 })?.pnlDollars, 12.5);
});

test("ignores quotes older than the trade entry", () => {
  assert.equal(
    liveTradeEstimate({
      dollarsPerPricePoint: 30,
      entryPrice: 4_451.4,
      entryTime: "2026-08-10T19:31:00.000Z",
      markPrice: 4_448.7,
      markTime: "2026-08-10T19:30:00.000Z",
      riskDollars: 246,
      side: "long"
    }),
    null
  );
});
