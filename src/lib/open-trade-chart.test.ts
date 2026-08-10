import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManagedLevelStepPath,
  buildManagedLevelTimeline,
  buildOpenTradeChartPoints,
  latestOpenTradeMark,
  mergeLiveOpenTradeBar,
  resolveActiveTradeOverlayEnd,
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

test("a managed stop timeline retains the initial stop before break-even", () => {
  const startMs = Date.parse("2026-07-31T19:45:00.000Z");
  const firstTrailMs = Date.parse("2026-07-31T20:30:00.000Z");
  const breakEvenMs = Date.parse("2026-07-31T20:45:00.000Z");
  const endMs = Date.parse("2026-08-02T22:00:00.000Z");
  const timeline = buildManagedLevelTimeline(106.1640625, startMs, endMs, [
    { timeMs: firstTrailMs, value: 106.1484375 },
    { timeMs: breakEvenMs, value: 106.125 }
  ]);

  assert.deepEqual(timeline.slice(0, 3), [
    { timeMs: startMs, value: 106.1640625 },
    { timeMs: firstTrailMs, value: 106.1640625 },
    { timeMs: firstTrailMs + 1000, value: 106.1484375 }
  ]);
  assert.deepEqual(timeline.slice(-2), [
    { timeMs: breakEvenMs + 1000, value: 106.125 },
    { timeMs: endMs, value: 106.125 }
  ]);
});

test("an active overlay ends at the current candle instead of a stale planned exit", () => {
  assert.equal(resolveActiveTradeOverlayEnd(false, "planned-exit", "latest-candle"), "latest-candle");
  assert.equal(resolveActiveTradeOverlayEnd(true, "actual-exit", "latest-candle"), "actual-exit");
});

test("a ProjectX partial bar replaces the current minute and appends the next minute", () => {
  const replaced = mergeLiveOpenTradeBar(bars, {
    time: "2026-08-10T19:17:00.000Z",
    open: 4445,
    high: 4453,
    low: 4444.8,
    close: 4452.8
  });
  assert.equal(replaced.length, bars.length);
  assert.equal(replaced.at(-1)?.index, 12);
  assert.equal(replaced.at(-1)?.close, 4452.8);

  const appended = mergeLiveOpenTradeBar(replaced, {
    time: "2026-08-10T19:18:00.000Z",
    open: 4452.8,
    high: 4454,
    low: 4452.2,
    close: 4453.5
  });
  assert.equal(appended.length, bars.length + 1);
  assert.equal(appended.at(-1)?.index, 13);
  assert.equal(appended.at(-1)?.close, 4453.5);
});

test("an unchanged ProjectX partial bar preserves chart identity", () => {
  const unchanged = mergeLiveOpenTradeBar(bars, {
    time: bars.at(-1)!.time,
    open: bars.at(-1)!.open,
    high: bars.at(-1)!.high,
    low: bars.at(-1)!.low,
    close: bars.at(-1)!.close,
    volume: bars.at(-1)!.volume
  });

  assert.equal(unchanged, bars);
});
