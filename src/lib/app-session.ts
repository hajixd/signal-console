import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAppUserById, type AppUser } from "@/lib/app-auth";
import { adminApiSecret } from "@/lib/admin-api";

export const APP_SESSION_COOKIE = "tradingbot_user_session";
const APP_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

type SessionPayload = { expiresAt: number; userId: string };

function sessionSecret(): string {
  const secret = adminApiSecret() ?? (process.env.NODE_ENV === "production" ? "" : "tradingbot-local-user-session-secret");
  if (!secret) throw new Error("Set APP_ADMIN_SECRET or CRON_SECRET before enabling user sessions.");
  return secret;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAppSessionValue(userId: string, now = Date.now()): string {
  const payload: SessionPayload = { expiresAt: now + APP_SESSION_TTL_SECONDS * 1000, userId };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyAppSessionValue(value: string | undefined, now = Date.now()): SessionPayload | null {
  if (!value) return null;
  const [encoded, suppliedSignature] = value.split(".", 2);
  if (!encoded || !suppliedSignature) return null;
  try {
    const expectedSignature = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
    if (!safeEqual(suppliedSignature, expectedSignature)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (!payload.userId || !Number.isFinite(payload.expiresAt) || payload.expiresAt! <= now) return null;
    return { expiresAt: payload.expiresAt!, userId: payload.userId };
  } catch {
    return null;
  }
}

export function setAppSessionCookie(response: NextResponse, user: AppUser): void {
  response.cookies.set(APP_SESSION_COOKIE, createAppSessionValue(user.id), {
    httpOnly: true,
    maxAge: APP_SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

export function clearAppSessionCookie(response: NextResponse): void {
  response.cookies.set(APP_SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

export async function appUserFromRequest(request: NextRequest): Promise<AppUser | null> {
  const session = verifyAppSessionValue(request.cookies.get(APP_SESSION_COOKIE)?.value);
  return session ? getAppUserById(session.userId) : null;
}
