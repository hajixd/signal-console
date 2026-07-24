import assert from "node:assert/strict";
import test from "node:test";
import { hasFreshSignalBars } from "./market-data-store";
import type { Bar } from "./types";

function bar(time: number): Bar {
  return {
    close: 1,
    high: 1,
    low: 1,
    open: 1,
    time: new Date(time).toISOString(),
    volume: 0
  };
}

test("signal freshness tolerates one completed interval of provider lag", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-07-23T02:46:00.000Z");
  try {
    assert.equal(hasFreshSignalBars([bar(Date.parse("2026-07-23T02:15:00.000Z"))], "15m"), true);
    assert.equal(hasFreshSignalBars([bar(Date.parse("2026-07-23T02:00:00.000Z"))], "15m"), false);
  } finally {
    Date.now = originalNow;
  }
});
