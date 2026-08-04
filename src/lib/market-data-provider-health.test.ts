import test from "node:test";
import assert from "node:assert/strict";
import {
  markTwelveDataProviderFailure,
  resetMarketDataProviderHealthForTests,
  twelveDataAvailable,
  twelveDataCooldownRemainingMs
} from "@/lib/market-data-provider-health";

test("daily TwelveData credit exhaustion cools the provider until the next UTC day", () => {
  resetMarketDataProviderHealthForTests();
  const now = Date.UTC(2026, 7, 4, 17, 10, 0);
  markTwelveDataProviderFailure(new Error("You have run out of API credits for the day. Wait for the next day."), now);
  assert.equal(twelveDataAvailable(now), false);
  assert.ok(twelveDataCooldownRemainingMs(now) > 6 * 60 * 60 * 1000);
  assert.equal(twelveDataAvailable(Date.UTC(2026, 7, 5, 0, 6, 0)), true);
  resetMarketDataProviderHealthForTests();
});

test("ordinary provider failures do not disable TwelveData", () => {
  resetMarketDataProviderHealthForTests();
  const now = Date.UTC(2026, 7, 4, 17, 10, 0);
  markTwelveDataProviderFailure(new Error("Temporary connection reset"), now);
  assert.equal(twelveDataAvailable(now), true);
});

test("HTTP 429 uses a short cooldown", () => {
  resetMarketDataProviderHealthForTests();
  const now = Date.UTC(2026, 7, 4, 17, 10, 0);
  markTwelveDataProviderFailure(new Error("TwelveData 429: too many requests"), now);
  assert.equal(twelveDataAvailable(now), false);
  assert.equal(twelveDataAvailable(now + 16 * 60_000), true);
  resetMarketDataProviderHealthForTests();
});
