import assert from "node:assert/strict";
import test from "node:test";
import { TwelveDataKeyRotation, twelveDataKeyCooldownUntil } from "@/lib/twelve-data-key-rotation";

test("concurrent Twelve Data requests rotate their first key", () => {
  const rotation = new TwelveDataKeyRotation();
  const keys = ["key-a", "key-b", "key-c"];

  assert.deepEqual(rotation.orderedKeys(keys), ["key-a", "key-b", "key-c"]);
  assert.deepEqual(rotation.orderedKeys(keys), ["key-b", "key-c", "key-a"]);
  assert.deepEqual(rotation.orderedKeys(keys), ["key-c", "key-a", "key-b"]);
});

test("a per-minute quota failure cools only that key until the next minute", () => {
  const rotation = new TwelveDataKeyRotation();
  const now = Date.UTC(2026, 7, 10, 17, 35, 40);
  rotation.markFailure("key-a", new Error("You have run out of API credits for the current minute."), now);

  assert.deepEqual(rotation.orderedKeys(["key-a", "key-b"], now), ["key-b"]);
  assert.deepEqual(rotation.orderedKeys(["key-a", "key-b"], Date.UTC(2026, 7, 10, 17, 36, 6)), ["key-a", "key-b"]);
});

test("a daily quota failure keeps only the exhausted key out until the next UTC day", () => {
  const rotation = new TwelveDataKeyRotation();
  const now = Date.UTC(2026, 7, 10, 17, 35, 40);
  rotation.markFailure("key-a", new Error("API credits for the day are exhausted. Wait for the next day."), now);

  assert.deepEqual(rotation.orderedKeys(["key-a", "key-b"], Date.UTC(2026, 7, 10, 23, 59, 59)), ["key-b"]);
  assert.deepEqual(rotation.orderedKeys(["key-a", "key-b"], Date.UTC(2026, 7, 11, 0, 5, 1)), ["key-a", "key-b"]);
});

test("ordinary provider errors do not cool a key", () => {
  const now = Date.UTC(2026, 7, 10, 17, 35, 40);
  assert.equal(twelveDataKeyCooldownUntil(new Error("Temporary connection reset"), now), undefined);
});
