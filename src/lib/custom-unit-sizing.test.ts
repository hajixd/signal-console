import assert from "node:assert/strict";
import test from "node:test";
import { autoTradeRequest, mappedSize, nonExecutableOrderSizeReason, plannedAutoTradeSizeForTrade, realAutoTradeSizeForTrade } from "@/lib/auto-trade-utils";
import { customUnitSizeMultiplierForTrade } from "@/lib/custom-unit-sizing";
import {
  alertTargetDollarsWithSize,
  liveClosedTradePnlDollars,
  liveTradeEventAutoTradeOrders
} from "@/lib/live-trade-calculations";
import { projectXBracketTicksForTrade, projectXLegacyOrderSummarySize, projectXOrderSizeForAccount } from "@/lib/projectx-auto-trader";
import type { StrategySignal } from "@/lib/strategy-definition";
import { planTradeAlert } from "@/lib/trade-planner";
import type { StrategyRule, TradeAlert } from "@/lib/types";

const customScaleRange = {
  riskCeiling: "500",
  riskFloor: "300",
  targetCeiling: "1500",
  targetFloor: "1000"
};

function trade(overrides: Partial<TradeAlert> = {}): TradeAlert {
  return {
    createdAt: "2026-06-26T00:00:00.000Z",
    customScaleRange,
    entryMode: "test",
    entryPrice: 20_000,
    estimatedWinRatePct: 50,
    id: "custom-unit-test",
    liveProfitFactor: 1,
    market: "futures",
    side: "long",
    signalTime: "2026-06-26T00:00:00.000Z",
    sizeMultiplier: 99,
    slUnits: 149,
    status: "alerted",
    stopLossPrice: 19_962.75,
    strategy: "Custom unit test",
    symbol: "NQ",
    takeProfitPrice: 20_111.75,
    telegramStatus: "skipped",
    tpUnits: 447,
    unitLabel: "ticks",
    ...overrides
  };
}

const rule: StrategyRule = {
  assetKey: "nasdaq_100_futures",
  customScaleRange,
  estimatedWinRatePct: 50,
  key: "custom-unit-rule",
  label: "Custom unit rule",
  liveProfitFactor: 1,
  logicalKey: "custom-unit-rule",
  market: "futures",
  phase: "test",
  sizeMultiplier: 99,
  slUnits: 149,
  strategyId: "custom-unit-rule",
  symbol: "NQ",
  tickSize: 0.25,
  tpUnits: 447,
  unitLabel: "ticks"
};

function signal(overrides: Partial<StrategySignal> = {}): StrategySignal {
  return {
    entryPrice: 20_000,
    side: "long",
    signalTime: "2026-06-26T00:00:00.000Z",
    slUnits: 149,
    stopLossMode: "units",
    stopLossPrice: 19_962.75,
    takeProfitMode: "units",
    takeProfitPrice: 20_111.75,
    tpUnits: 447,
    ...overrides
  };
}

test("recalculates custom units from every trade's own stop and target", () => {
  assert.equal(customUnitSizeMultiplierForTrade(trade()), 6.711409);
  assert.equal(customUnitSizeMultiplierForTrade(trade({ slUnits: 200, tpUnits: 600 })), 5);
});

test("planner snapshots the range and sizes each signal independently", () => {
  const first = planTradeAlert(rule, signal(), [], 0, "test");
  const second = planTradeAlert(
    rule,
    signal({
      slUnits: 200,
      stopLossPrice: 19_950,
      takeProfitPrice: 20_150,
      tpUnits: 600
    }),
    [],
    0,
    "test"
  );

  assert.equal(first?.sizeMultiplier, 6.711409);
  assert.equal(second?.sizeMultiplier, 5);
  assert.deepEqual(first?.customScaleRange, customScaleRange);
  assert.deepEqual(second?.customScaleRange, customScaleRange);
});

test("custom auto trade sizing uses the largest ceiling-safe whole futures size", () => {
  assert.equal(mappedSize("TRADOVATE", trade(), undefined, { accountName: "50K account" }), 6);
});

test("live auto trade requests attempt the max custom-safe futures size", () => {
  const request = autoTradeRequest("TRADOVATE", trade(), 1, {
    accountName: "50K account",
    sizeMap: '{"NQ":"2"}'
  });

  assert.equal(request.size, 6);
});

test("live futures requests skip instead of rounding custom size above the ceiling", () => {
  const request = autoTradeRequest(
    "TRADOVATE",
    trade({
      customScaleRange: {
        riskCeiling: "10",
        riskFloor: "1",
        targetCeiling: "20",
        targetFloor: "1"
      }
    }),
    1
  );

  assert.equal(request.size, 0);
  assert.equal(
    nonExecutableOrderSizeReason(request),
    "Order skipped because the custom unit parameters leave no executable whole futures contract."
  );
});

test("ProjectX live orders attempt the max custom-safe futures size", () => {
  assert.equal(
    projectXOrderSizeForAccount(
      trade({ sizeMultiplier: 1 }),
      { canTrade: true, id: 1, isVisible: true, name: "50K account" },
      1
    ),
    6
  );
});

test("legacy ProjectX order metadata falls back to max executable custom futures size", () => {
  assert.equal(
    projectXLegacyOrderSummarySize(
      trade({
        autoTradeAccountId: 1,
        autoTradeAccountName: "50K account",
        autoTradeOrderId: 123,
        autoTradeStatus: "placed",
        sizeMultiplier: 24
      }),
      false
    ),
    6
  );
});

test("ProjectX bracket ticks are positive distances after side geometry validation", () => {
  assert.deepEqual(
    projectXBracketTicksForTrade({
      entryPrice: 61_090,
      side: "short",
      slUnits: 41,
      stopLossPrice: 61_295,
      takeProfitPrice: 60_885,
      tpUnits: 41
    }),
    { stopLossTicks: 41, takeProfitTicks: 41 }
  );
  assert.deepEqual(
    projectXBracketTicksForTrade({
      entryPrice: 6_000,
      side: "long",
      slUnits: 10,
      stopLossPrice: 5_997.5,
      takeProfitPrice: 6_005,
      tpUnits: 20
    }),
    { stopLossTicks: 10, takeProfitTicks: 20 }
  );
});

test("planned live execution uses the largest ceiling-safe whole futures size", () => {
  assert.equal(plannedAutoTradeSizeForTrade(trade()), 6);
  assert.equal(plannedAutoTradeSizeForTrade(trade({ slUnits: 200, tpUnits: 600 })), 5);
});

test("planned live execution floors saved custom sizes for older futures trades without a range snapshot", () => {
  const olderLiveTrade = trade({ customScaleRange: undefined, sizeMode: "custom", sizeMultiplier: 24.3902, slUnits: 41, tpUnits: 41 });

  assert.equal(plannedAutoTradeSizeForTrade(olderLiveTrade), 24);
});

test("real live reporting uses stored execution size before planned size", () => {
  assert.equal(
    realAutoTradeSizeForTrade(
      trade({
        autoTradeOrders: [
          { accountId: 1, size: 5, status: "placed" },
          { accountId: 2, size: 3, status: "dry_run" },
          { accountId: 3, size: 99, status: "failed" }
        ]
      })
    ),
    8
  );
});

test("live MBT display uses executed size and bounded bracket dollars", () => {
  const mbtTrade = trade({
    autoTradeOrders: [{ accountId: 1, contractName: "MBTM6", size: 5, status: "placed" }],
    customScaleRange: undefined,
    entryPrice: 61_090,
    entryType: "limit",
    lifecyclePnlDollars: 500,
    lifecycleRMultiple: 500 / 102.5,
    lifecycleStatus: "take_profit",
    market: "futures",
    side: "short",
    sizeMode: "custom",
    sizeMultiplier: 24,
    slUnits: 41,
    stopLossPrice: 61_295,
    symbol: "MBT",
    takeProfitPrice: 60_885,
    tpUnits: 41
  });
  const limitOrders = liveTradeEventAutoTradeOrders(mbtTrade, "limit");
  const executedSize = realAutoTradeSizeForTrade(mbtTrade, mbtTrade.sizeMultiplier, limitOrders);

  assert.equal(executedSize, 5);
  assert.equal(alertTargetDollarsWithSize(mbtTrade, executedSize), 102.5);
  assert.equal(liveClosedTradePnlDollars(mbtTrade, executedSize), 102.5);
});

test("custom units override a static provider size map", () => {
  assert.equal(mappedSize("TRADOVATE", trade(), undefined, { accountName: "50K account", sizeMap: '{"NQ":"20"}' }), 6);
});

test("non-custom futures sizing retains existing upward rounding", () => {
  assert.equal(mappedSize("TRADOVATE", trade({ customScaleRange: undefined, sizeMultiplier: 6.711409 }), undefined, { accountName: "50K account" }), 4);
});
