import assert from "node:assert/strict";
import test from "node:test";

import { liveBrokerExecutionOutcome, liveClosedTradePnlDollars, liveOpenTradePnlDollars } from "@/lib/live-trade-calculations";
import type { TradeAlert } from "@/lib/types";

function projectXCornTrade(): TradeAlert {
  return {
    autoTradeOrders: [
      {
        accountId: 2959014500,
        feesDollars: 10.7,
        filledPrice: 458.5,
        grossPnlDollars: 375,
        netPnlDollars: 364.3,
        resultCheckedAt: "2026-08-06T16:45:27.000Z",
        resultTradeId: 2959014500,
        size: 5,
        status: "placed"
      }
    ],
    createdAt: "2026-08-06T15:45:00.000Z",
    entryMode: "live",
    entryPrice: 459,
    estimatedWinRatePct: 54,
    id: "projectx-corn-result",
    lifecyclePnlDollars: 364.3,
    lifecyclePrice: 457.75,
    lifecycleRMultiple: 1.16576,
    lifecycleStatus: "take_profit",
    lifecycleTime: "2026-08-06T16:00:00.000Z",
    liveProfitFactor: 2,
    market: "futures",
    side: "long",
    signalTime: "2026-08-06T15:45:00.000Z",
    sizeMultiplier: 5,
    slUnits: 5,
    status: "alerted",
    stopLossPrice: 457.75,
    strategy: "ZC US First30 Midday Momentum 1m",
    symbol: "ZC",
    takeProfitPrice: 460.25,
    telegramStatus: "skipped",
    tpUnits: 5,
    unitLabel: "ticks"
  };
}

test("broker outcome reconstructs a legacy ProjectX closing price from gross P&L", () => {
  const outcome = liveBrokerExecutionOutcome(projectXCornTrade());

  assert.ok(outcome);
  assert.equal(outcome.entryPrice, 458.5);
  assert.equal(outcome.exitPrice, 460);
  assert.equal(outcome.exitTime, undefined);
  assert.equal(outcome.grossPnlDollars, 375);
  assert.equal(outcome.netPnlDollars, 364.3);
  assert.equal(outcome.sizeMultiplier, 5);
});

test("broker net P&L is not capped to the signal's planned take-profit dollars", () => {
  assert.equal(
    liveClosedTradePnlDollars(projectXCornTrade(), 5, { riskDollars: 312.5, targetDollars: 312.5 }),
    364.3
  );
});

test("open mark P&L cannot run past the trade's take-profit or stop-loss bracket", () => {
  const trade = { ...projectXCornTrade(), lifecycleStatus: "open" as const };

  assert.equal(liveOpenTradePnlDollars(trade, 0.25, 500, 5), 312.5);
  assert.equal(liveOpenTradePnlDollars(trade, 0.25, 400, 5), -312.5);
});
