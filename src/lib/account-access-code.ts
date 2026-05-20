import { createHash, timingSafeEqual } from "node:crypto";

export const ACCESS_CODE_PATTERN = /^\d{5}$/;

function accessCodeSecret(): string {
  return (
    process.env.AUTO_TRADE_ACCESS_CODE_SECRET ??
    process.env.AUTO_TRADE_CONNECTION_SECRET ??
    process.env.PROJECTX_CONNECTION_SECRET ??
    process.env.APP_ADMIN_SECRET ??
    process.env.CRON_SECRET ??
    "tradingbot-local-access-code-secret"
  );
}

export function normalizeAccessCode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidAccessCode(value: unknown): value is string {
  return ACCESS_CODE_PATTERN.test(normalizeAccessCode(value));
}

export function hashAccessCode(value: string): string {
  return createHash("sha256").update(`${accessCodeSecret()}:${normalizeAccessCode(value)}`).digest("hex");
}

export function verifyAccessCode(input: unknown, storedHash?: string): boolean {
  const normalized = normalizeAccessCode(input);
  if (!ACCESS_CODE_PATTERN.test(normalized) || !storedHash) return false;

  const actualHash = hashAccessCode(normalized);
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
