import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManagedLevelStepPath,
  buildOpenTradeChartPoints,
  latestOpenTradeMark,
  resolveOpenTradePathRange,
  type OpenTradeChartBar,
  type OpenTradeChartTrade
} from "@/lib/open-trade-chart";

const trade: OpenTradeChartTrade = {
  dollarsPerPricePoint: 30,
  entryIndex: 10,
  entryPrice: 4449.6,
  entryTime: "2026-08-10T19:15:00.000Z",
  side: "long"
};

const bars: OpenTradeChartBar[] = [
  { index: 10, time: "2026-08-10T19:15:00.000Z", open: 4449.6, high: 4450.2, low: 4449.2, close: 4449.8 },
  { index: 11, time: "2026-08-10T19:16:00.000Z", open: 4449.8, high: 4450, low: 4440.8, close: 4445 },
  { index: 12, time: "2026-08-10T19:17:00.000Z", open: 4445, high: 4452.4, low: 4444.8, close: 4452 }
];

test("an open trade continues to the latest bar after an earlier planned stop touch", () => {
  const range = resolveOpenTradePathRange(trade, bars);

  assert.equal(range?.boundary, null);
  assert.equal(range?.end, 2);
  assert.equal(range?.exitPrice, 4452);
  assert.equal(range?.exitTime, "2026-08-10T19:17:00.000Z");
});

test("an open mini chart uses actual bars instead of a fabricated entry-to-mark line", () => {
  const points = buildOpenTradeChartPoints(trade, bars);

  assert.equal(points.length, 4);
  assert.deepEqual(points.slice(1).map((point) => point.price), [4449.8, 4445, 4452]);
  assert.deepEqual(buildOpenTradeChartPoints(trade, []), []);
});

test("the latest chart bar supplies the synchronized live mark and unrealized PnL", () => {
  assert.deepEqual(latestOpenTradeMark(trade, bars), {
    exitPrice: 4452,
    exitTime: "2026-08-10T19:17:00.000Z",
    pnlDollars: 72
  });
});

test("a break-even stop is rendered as a visible price step at its change time", () => {
  const path = buildManagedLevelStepPath(
    [
      { x: 0, value: 4441.4 },
      { x: 35, value: 4449.6 },
      { x: 62, value: 4451.2 }
    ],
    90,
    (value) => value * 10,
    (value) => 5000 - value
  );

  assert.equal(path, "M 0.00 558.60 H 350.00 V 550.40 H 620.00 V 548.80 H 900.00");
});
