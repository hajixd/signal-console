import assert from "node:assert/strict";
import test from "node:test";
import { hashAppPassword, normalizeAppUsername, validateAppPassword, validateAppUsername, verifyAppPassword } from "@/lib/app-auth";
import { createAppSessionValue, verifyAppSessionValue } from "@/lib/app-session";

test("usernames normalize and reject unsafe values", () => {
  assert.equal(normalizeAppUsername("  Korra_Admin  "), "korra_admin");
  assert.equal(validateAppUsername("Korra_Admin"), "korra_admin");
  assert.equal(validateAppUsername("no spaces"), null);
  assert.equal(validateAppUsername("ab"), null);
});

test("password hashes verify without storing the password", async () => {
  const hash = await hashAppPassword("a-secure-password");
  assert.equal(hash.includes("a-secure-password"), false);
  assert.equal(await verifyAppPassword("a-secure-password", hash), true);
  assert.equal(await verifyAppPassword("wrong-password", hash), false);
  assert.equal(validateAppPassword("short"), null);
});

test("signed sessions reject tampering and expiry", () => {
  const now = Date.now();
  const value = createAppSessionValue("user-123", now);
  assert.equal(verifyAppSessionValue(value, now + 1)?.userId, "user-123");
  assert.equal(verifyAppSessionValue(`${value}x`, now + 1), null);
  assert.equal(verifyAppSessionValue(value, now + 8 * 24 * 60 * 60_000), null);
});
