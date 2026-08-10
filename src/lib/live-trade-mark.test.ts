import assert from "node:assert/strict";
import test from "node:test";
import { freshLiveTradeMark, liveTradeChartPathIsCurrent } from "./live-trade-mark";

const now = new Date("2026-08-10T19:15:00.000Z");

test("accepts a current mark inside the configured lifecycle", () => {
  assert.deepEqual(
    freshLiveTradeMark(
      { maxBars: 60, signalTime: "2026-08-10T18:45:00.000Z" },
      { price: 460.25, time: "2026-08-10T19:14:00.000Z" },
      now
    ),
    { price: 460.25, time: "2026-08-10T19:14:00.000Z" }
  );
});

test("accepts a fresh current-price estimate for an older open alert", () => {
  assert.deepEqual(
    freshLiveTradeMark(
      { maxBars: 24, signalTime: "2026-05-11T07:45:00.000Z" },
      { price: 4676.4, time: "2026-08-10T19:14:00.000Z" },
      now
    ),
    { price: 4676.4, time: "2026-08-10T19:14:00.000Z" }
  );
  assert.equal(liveTradeChartPathIsCurrent({ maxBars: 24, signalTime: "2026-05-11T07:45:00.000Z" }, now), false);
});

test("rejects a stale or pre-entry mark", () => {
  assert.equal(
    freshLiveTradeMark(
      { maxBars: 60, signalTime: "2026-08-10T18:45:00.000Z" },
      { price: 460.25, time: "2026-08-10T18:44:00.000Z" },
      now
    ),
    null
  );
  assert.equal(
    freshLiveTradeMark(
      { maxBars: 60, signalTime: "2026-08-10T18:45:00.000Z" },
      { price: 460.25, time: "2026-08-10T18:55:00.000Z" },
      now,
      { maxMarkLagMinutes: 10 }
    ),
    null
  );
});

test("accepts the last genuine futures mark through the daily maintenance pause", () => {
  assert.deepEqual(
    freshLiveTradeMark(
      { maxBars: 240, signalTime: "2026-08-10T19:15:00.000Z" },
      { price: 4448.7, time: "2026-08-10T20:59:00.000Z" },
      new Date("2026-08-10T21:42:00.000Z"),
      { maxMarkLagMinutes: 90 }
    ),
    { price: 4448.7, time: "2026-08-10T20:59:00.000Z" }
  );
});
