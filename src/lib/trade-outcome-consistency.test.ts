import assert from "node:assert/strict";
import test from "node:test";

import { consistentTradeOutcome } from "@/lib/trade-outcome-consistency";

test("a long exit below entry cannot display as a profitable take profit", () => {
  const outcome = consistentTradeOutcome({
    dollarsPerPricePoint: 250,
    entryPrice: 459,
    exitPrice: 457.75,
    exitReason: "take_profit",
    pnlDollars: 313,
    priceTolerance: 0.125,
    side: "long",
    stopPrice: 457.75,
    targetPrice: 460.25
  });

  assert.equal(outcome.pnlDollars, -312.5);
  assert.equal(outcome.exitReason, "stop_loss");
  assert.equal(outcome.corrected, true);
});

test("a profitable trailing-stop exit keeps its stop-loss reason", () => {
  const outcome = consistentTradeOutcome({
    dollarsPerPricePoint: 100,
    entryPrice: 100,
    exitPrice: 102,
    exitReason: "stop_loss",
    exitTime: "2026-08-06T16:00:00.000Z",
    managementEvents: [
      {
        createdAt: "2026-08-06T15:55:00.000Z",
        id: "trail",
        price: 102,
        time: "2026-08-06T15:55:00.000Z",
        type: "edit_sl"
      }
    ],
    pnlDollars: 200,
    priceTolerance: 0.01,
    side: "long",
    stopPrice: 98,
    targetPrice: 104
  });

  assert.equal(outcome.pnlDollars, 200);
  assert.equal(outcome.exitReason, "stop_loss");
  assert.equal(outcome.corrected, false);
});

test("a short exit above entry cannot display as a profitable take profit", () => {
  const outcome = consistentTradeOutcome({
    dollarsPerPricePoint: 100,
    entryPrice: 100,
    exitPrice: 102,
    exitReason: "take_profit",
    pnlDollars: 200,
    priceTolerance: 0.01,
    side: "short",
    stopPrice: 102,
    targetPrice: 98
  });

  assert.equal(outcome.pnlDollars, -200);
  assert.equal(outcome.exitReason, "stop_loss");
  assert.equal(outcome.corrected, true);
});

test("target prices correct stale stop labels for long and short winners", () => {
  for (const input of [
    { entryPrice: 100, exitPrice: 102, side: "long" as const, stopPrice: 98, targetPrice: 102 },
    { entryPrice: 100, exitPrice: 98, side: "short" as const, stopPrice: 102, targetPrice: 98 }
  ]) {
    const outcome = consistentTradeOutcome({
      ...input,
      dollarsPerPricePoint: 100,
      exitReason: "stop_loss",
      pnlDollars: 195,
      priceTolerance: 0.01
    });

    assert.equal(outcome.pnlDollars, 195);
    assert.equal(outcome.exitReason, "take_profit");
    assert.equal(outcome.corrected, true);
  }
});

test("fees remain included when price direction and net P&L agree", () => {
  const outcome = consistentTradeOutcome({
    dollarsPerPricePoint: 100,
    entryPrice: 100,
    exitPrice: 102,
    exitReason: "take_profit",
    pnlDollars: 195,
    priceTolerance: 0.01,
    side: "long",
    stopPrice: 98,
    targetPrice: 102
  });

  assert.equal(outcome.pricePnlDollars, 200);
  assert.equal(outcome.pnlDollars, 195);
  assert.equal(outcome.corrected, false);
});
