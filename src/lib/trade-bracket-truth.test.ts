import assert from "node:assert/strict";
import test from "node:test";
import {
  oneMinuteBarsHeld,
  resolveFirstTradeBracketHit,
  type TradeBracketBar,
  type TradeBracketInput
} from "@/lib/trade-bracket-truth";

function bar(minute: number, open: number, high: number, low: number, close: number): TradeBracketBar {
  return {
    close,
    high,
    index: minute,
    low,
    open,
    time: `2026-08-06T16:${String(minute).padStart(2, "0")}:00.000Z`
  };
}

function longTrade(overrides: Partial<TradeBracketInput> = {}): TradeBracketInput {
  return {
    entryIndex: 0,
    entryPrice: 100,
    entryTime: "2026-08-06T16:00:00.000Z",
    exitIndex: 5,
    exitTime: "2026-08-06T16:05:00.000Z",
    side: "long",
    stopPrice: 98,
    targetPrice: 102,
    ...overrides
  };
}

test("durations universally count one-minute bars", () => {
  assert.equal(oneMinuteBarsHeld("2026-08-06T16:00:00.000Z", "2026-08-06T16:15:00.000Z"), 15);
  assert.equal(oneMinuteBarsHeld("2026-08-06T16:00:00.000Z", "2026-08-06T16:23:00.000Z"), 23);
  assert.equal(oneMinuteBarsHeld("2026-08-06T16:00:00.000Z", "2026-08-06T16:00:00.000Z"), 1);
});

test("a trade ends on the first one-minute candle that touches its target", () => {
  const bars = [
    bar(0, 100, 100.5, 99.5, 100.2),
    bar(1, 100.2, 101.2, 100, 101),
    bar(2, 101, 102.25, 100.8, 102),
    bar(3, 102, 103, 101.5, 102.8),
    bar(4, 102.8, 103.2, 101.8, 102.2),
    bar(5, 102.2, 104, 102, 103.5)
  ];

  const hit = resolveFirstTradeBracketHit(longTrade(), bars);

  assert.equal(hit?.boundary, "target");
  assert.equal(hit?.exitTime, "2026-08-06T16:02:00.000Z");
  assert.equal(hit?.exitPrice, 102);
  assert.equal(hit?.barsHeld, 2);
  assert.equal(hit?.position, 2);
});

test("the conservative stop wins when one candle touches both brackets", () => {
  const bars = [bar(0, 100, 100.5, 99.5, 100), bar(1, 100, 102.5, 97.5, 101)];
  const hit = resolveFirstTradeBracketHit(
    longTrade({ exitIndex: 1, exitTime: "2026-08-06T16:01:00.000Z" }),
    bars
  );

  assert.equal(hit?.boundary, "stop");
  assert.equal(hit?.exitPrice, 98);
  assert.equal(hit?.exitTime, "2026-08-06T16:01:00.000Z");
});

test("moving stop levels also end the path on their first one-minute touch", () => {
  const bars = [
    bar(0, 100, 100.5, 99.5, 100.2),
    bar(1, 100.2, 101.5, 100.1, 101.3),
    bar(2, 101.3, 101.4, 100.8, 101)
  ];
  const hit = resolveFirstTradeBracketHit(
    longTrade({
      exitIndex: 2,
      exitTime: "2026-08-06T16:02:00.000Z",
      managementEvents: [
        {
          price: 101,
          stopLossPrice: 101,
          time: "2026-08-06T16:02:00.000Z",
          type: "edit_sl"
        }
      ]
    }),
    bars
  );

  assert.equal(hit?.boundary, "stop");
  assert.equal(hit?.exitPrice, 101);
  assert.equal(hit?.exitTime, "2026-08-06T16:02:00.000Z");
});
