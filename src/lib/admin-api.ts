import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";

export const ADMIN_SESSION_COOKIE = "tradingbot_admin_session";
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60_000;

type CookieOptions = {
  httpOnly: boolean;
  maxAge: number;
  path: string;
  sameSite: "lax";
  secure: boolean;
};

export function adminApiSecret(): string | undefined {
  return process.env.APP_ADMIN_SECRET ?? process.env.CRON_SECRET;
}

function adminAccessCode(): string | undefined {
  return "12345";
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionSignature(expiresAt: number): string | null {
  const secret = adminApiSecret() ?? (process.env.NODE_ENV === "production" ? undefined : "tradingbot-local-admin-session-secret");
  if (!secret) return null;
  return createHmac("sha256", secret).update(String(expiresAt)).digest("hex");
}

function cookieValue(headersCookie: string | null, name: string): string | undefined {
  return headersCookie
    ?.split(";")
    .map((item) => item.trim())
    .map((item) => {
      const separator = item.indexOf("=");
      return separator < 0 ? null : [item.slice(0, separator), item.slice(separator + 1)] as const;
    })
    .find((item): item is readonly [string, string] => Boolean(item && item[0] === name))?.[1];
}

function bearerAuthorized(authorization: string | null): boolean {
  const secret = adminApiSecret();
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

export function verifyAdminAccessCode(input: unknown): boolean {
  const configured = adminAccessCode();
  const normalized = typeof input === "string" ? input.trim() : "";
  return Boolean(configured && normalized && safeCompare(normalized, configured));
}

export function createAdminSessionCookieValue(now = Date.now()): string {
  const expiresAt = now + ADMIN_SESSION_TTL_MS;
  const signature = sessionSignature(expiresAt);
  if (!signature) throw new Error("Set APP_ADMIN_SECRET or CRON_SECRET before enabling admin sessions.");
  return `${expiresAt}.${signature}`;
}

export function adminSessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  };
}

export function expiredAdminSessionCookieOptions(): CookieOptions {
  return {
    ...adminSessionCookieOptions(),
    maxAge: 0
  };
}

export function verifyAdminSessionCookie(value: string | undefined): boolean {
  if (!value) return false;
  const [expiresAtValue, suppliedSignature] = value.split(".", 2);
  const expiresAt = Number(expiresAtValue);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !suppliedSignature) return false;
  const expectedSignature = sessionSignature(expiresAt);
  return Boolean(expectedSignature && safeCompare(suppliedSignature, expectedSignature));
}

export function isAdminAuthorized(request: Request): boolean {
  if (bearerAuthorized(request.headers.get("authorization"))) return true;
  return verifyAdminSessionCookie(cookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE));
}

export async function isServerActionAdminAuthorized(): Promise<boolean> {
  const requestHeaders = await headers();
  if (bearerAuthorized(requestHeaders.get("authorization"))) return true;
  return verifyAdminSessionCookie((await cookies()).get(ADMIN_SESSION_COOKIE)?.value);
}

export async function assertServerActionAdminAuthorized(): Promise<void> {
  if (!(await isServerActionAdminAuthorized())) {
    throw new Error("Unauthorized admin action.");
  }
}
