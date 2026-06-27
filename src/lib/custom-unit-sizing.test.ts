import assert from "node:assert/strict";
import test from "node:test";
import { mappedSize, plannedAutoTradeSizeForTrade } from "@/lib/auto-trade-utils";
import { customUnitSizeMultiplierForTrade } from "@/lib/custom-unit-sizing";
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

test("uses ceiling-safe whole units after account scaling", () => {
  assert.equal(mappedSize("TRADOVATE", trade(), undefined, { accountName: "50K account" }), 3);
});

test("planned live execution uses the largest ceiling-safe whole futures size", () => {
  assert.equal(plannedAutoTradeSizeForTrade(trade()), 6);
  assert.equal(plannedAutoTradeSizeForTrade(trade({ slUnits: 200, tpUnits: 600 })), 5);
});

test("custom units override a static provider size map", () => {
  assert.equal(mappedSize("TRADOVATE", trade(), undefined, { accountName: "50K account", sizeMap: '{"NQ":"20"}' }), 3);
});

test("non-custom futures sizing retains existing upward rounding", () => {
  assert.equal(mappedSize("TRADOVATE", trade({ customScaleRange: undefined, sizeMultiplier: 6.711409 }), undefined, { accountName: "50K account" }), 4);
});
