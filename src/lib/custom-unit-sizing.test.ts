import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveProviderSizeAttemptSequence,
  autoTradeRequest,
  executionSizeErrorAllowsRetry,
  mappedSize,
  nonExecutableOrderSizeReason,
  plannedAutoTradeSizeForTrade,
  realAutoTradeSizeForTrade
} from "@/lib/auto-trade-utils";
import { adjustAutoTradeSizeToLimits } from "@/lib/auto-trade-risk";
import { customUnitSizeMultiplierForTrade } from "@/lib/custom-unit-sizing";
import {
  alertTargetDollarsWithSize,
  liveClosedTradePnlDollars,
  liveTradeEventAutoTradeOrders
} from "@/lib/live-trade-calculations";
import {
  projectXBracketTicksForTrade,
  projectXLegacyOrderSummarySize,
  projectXOrderSizeForAccount,
  projectXSizeAfterRecentFailure
} from "@/lib/projectx-auto-trader";
import { resolveMt5Lots } from "@/lib/mt5-ea-sizing";
import type { StrategySignal } from "@/lib/strategy-definition";
import { planTradeAlert } from "@/lib/trade-planner";
import { reviewTopstepSignal } from "@/lib/topstep";
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

test("legacy ProjectX order metadata keeps explicit stored execution size", () => {
  assert.equal(
    projectXLegacyOrderSummarySize(
      trade({
        autoTradeAccountId: 1,
        autoTradeAccountName: "50K account",
        autoTradeOrderId: 123,
        autoTradeStatus: "placed",
        entryOrderSizeMultiplier: 5,
        sizeMultiplier: 24
      }),
      false
    ),
    5
  );
});

test("ProjectX bracket ticks use broker-required directional offsets after geometry validation", () => {
  assert.deepEqual(
    projectXBracketTicksForTrade({
      entryPrice: 61_090,
      side: "short",
      slUnits: 41,
      stopLossPrice: 61_295,
      takeProfitPrice: 60_885,
      tpUnits: 41
    }),
    { stopLossTicks: 41, takeProfitTicks: -41 }
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
    { stopLossTicks: -10, takeProfitTicks: 20 }
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

test("an execution size cap overrides custom sizing and provider size maps", () => {
  const cappedTrade = trade({ autoTradeSizeCap: 2 });

  assert.equal(plannedAutoTradeSizeForTrade(cappedTrade), 2);
  assert.equal(mappedSize("TRADOVATE", cappedTrade, undefined, { sizeMap: '{"NQ":"20"}' }), 2);
  assert.equal(autoTradeRequest("TRADOVATE", cappedTrade, 1, { sizeMap: '{"NQ":"20"}' }).size, 2);
});

test("a per-check risk budget reduces forex units instead of rejecting the trade", () => {
  const forexTrade = trade({
    customScaleRange: undefined,
    market: "forex",
    sizeMode: undefined,
    sizeMultiplier: 33.87,
    slUnits: 50,
    symbol: "AUDNZD",
    tpUnits: 50,
    unitLabel: "pips"
  });
  const adjustment = adjustAutoTradeSizeToLimits(forexTrade, { maxRiskDollars: 250 });

  assert.equal(adjustment.adjusted, true);
  assert.ok(adjustment.size > 0);
  assert.ok(adjustment.size < adjustment.originalSize);
  assert.ok(adjustment.riskDollars <= 250);
  assert.equal(plannedAutoTradeSizeForTrade(adjustment.trade), adjustment.size);
});

test("lot-based forex connectors receive actual lots after the shared size cap", () => {
  const forexTrade = mt5ForexTrade();

  assert.equal(mappedSize("MATCHTRADER", forexTrade), 0.84);
  assert.equal(mappedSize("MATCHTRADER", forexTrade), 0.84);
  assert.equal(mappedSize("MT5", forexTrade), 0.84);
  assert.deepEqual(
    { size: autoTradeRequest("MATCHTRADER", forexTrade).size, sizeUnit: autoTradeRequest("MATCHTRADER", forexTrade).sizeUnit },
    { size: 0.84, sizeUnit: "lots" }
  );
});

test("cTrader forex bridge receives base units while retaining the same risk cap", () => {
  const request = autoTradeRequest("CTRADER", mt5ForexTrade());

  assert.equal(request.size, 84_600);
  assert.equal(request.sizeUnit, "base_units");
});

test("provider lot maps remain broker quantities but cannot bypass the shared cap", () => {
  const forexTrade = mt5ForexTrade();

  assert.equal(mappedSize("MATCHTRADER", forexTrade, undefined, { sizeMap: '{"AUDNZD":"5"}' }), 0.84);
  assert.equal(
    mappedSize("MATCHTRADER", forexTrade, undefined, { sizeMap: '{"AUDNZD":"0.5"}', volumeStep: "0.01" }),
    0.5
  );
});

test("provider execution records convert back to strategy units without changing legacy history", () => {
  const forexTrade = mt5ForexTrade();

  assert.equal(
    realAutoTradeSizeForTrade(forexTrade, undefined, [{ accountId: 1, size: 0.84, sizeUnit: "lots", status: "placed" }]),
    8.4
  );
  assert.equal(realAutoTradeSizeForTrade(forexTrade, undefined, [{ accountId: 1, size: 0.84, status: "placed" }]), 0.84);
});

test("broker size rejections retry progressively smaller valid quantities", () => {
  assert.deepEqual(adaptiveProviderSizeAttemptSequence(0.84, 0.01), [0.84, 0.42, 0.21, 0.1, 0.05, 0.02, 0.01]);
  assert.equal(executionSizeErrorAllowsRetry("Insufficient margin for requested volume"), true);
  assert.equal(executionSizeErrorAllowsRetry("Market is closed"), false);
  assert.equal(executionSizeErrorAllowsRetry("Daily loss limit reached"), false);
});

test("Topstep converts size, risk, and consistency breaches into a smaller executable order", () => {
  const oversizedTrade = trade({
    customScaleRange: undefined,
    sizeMode: "custom",
    sizeMultiplier: 99
  });
  const review = reviewTopstepSignal(rule, oversizedTrade);

  assert.equal(review.allowed, true);
  assert.equal(review.executableSize, 13);
  assert.equal(review.adjustedTrade.autoTradeSizeCap, 13);
  assert.match(review.adjustmentNote ?? "", /reduced units/i);
  assert.ok(review.riskDollars <= 1_250);
  assert.ok(review.targetDollars < 3_000);
});

test("ProjectX does not turn a remembered one-unit rejection into a durable execution block", () => {
  assert.equal(projectXSizeAfterRecentFailure(6, 1), 6);
  assert.equal(projectXSizeAfterRecentFailure(6, 4), 3);
});

async function withEnv(
  values: Record<string, string | undefined>,
  run: () => Promise<void>
): Promise<void> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function mt5ForexTrade(overrides: Partial<TradeAlert> = {}): TradeAlert {
  return trade({
    autoTradeSizeCap: 8.46,
    customScaleRange: undefined,
    entryPrice: 1.1,
    market: "forex",
    sizeMode: undefined,
    sizeMultiplier: 33.87,
    slUnits: 50,
    stopLossPrice: 1.095,
    symbol: "AUDNZD",
    takeProfitPrice: 1.105,
    tpUnits: 50,
    unitLabel: "pips",
    ...overrides
  });
}

const mt5SizingEnv = {
  MT5_EA_ACCOUNT_BALANCE: "100000",
  MT5_EA_LOT_OVERRIDE: undefined,
  MT5_EA_LOT_STEP: "0.01",
  MT5_EA_MAX_LOT: "50",
  MT5_EA_MIN_LOT: "0.01",
  MT5_EA_PIP_VALUE_OVERRIDE: undefined,
  MT5_EA_RISK_PER_TRADE_PCT: "0.5",
  TURSO_AUTH_TOKEN: undefined,
  TURSO_DATABASE_URL: undefined
};

test("MT5 converts the shared forex size cap to lots and reports actual capped risk", async () => {
  await withEnv(mt5SizingEnv, async () => {
    const sizing = await resolveMt5Lots(mt5ForexTrade(), "mt5-demo-100k");

    assert.equal(sizing.lots, 0.84);
    assert.ok(sizing.riskUsd > 0);
    assert.ok(sizing.riskUsd <= 250);
    assert.match(sizing.reason, /shared execution guard capped/i);
  });
});

test("MT5 risk guards cap fixed lot overrides instead of bypassing them", async () => {
  await withEnv({ ...mt5SizingEnv, MT5_EA_LOT_OVERRIDE: "AUDNZD:5" }, async () => {
    const sizing = await resolveMt5Lots(mt5ForexTrade(), "mt5-demo-100k");

    assert.equal(sizing.lots, 0.84);
    assert.ok(sizing.riskUsd <= 250);
    assert.match(sizing.reason, /lot override 5/i);
  });
});

test("MT5 does not force the broker minimum when no risk-safe lot remains", async () => {
  await withEnv(mt5SizingEnv, async () => {
    const sizing = await resolveMt5Lots(mt5ForexTrade({ autoTradeSizeCap: 0.05 }), "mt5-demo-100k");

    assert.equal(sizing.lots, 0);
    assert.equal(sizing.riskUsd, 0);
  });
});
