import { NextRequest, NextResponse } from "next/server";
import { authenticateAppUser, removeAppPresence } from "@/lib/app-auth";
import { appUserFromRequest, clearAppSessionCookie, setAppSessionCookie } from "@/lib/app-session";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  createAdminSessionCookieValue,
  expiredAdminSessionCookieOptions
} from "@/lib/admin-api";
import { checkRateLimit, requestClientKey } from "@/lib/request-throttle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function applyRoleCookie(response: NextResponse, role: "admin" | "user") {
  if (role === "admin") {
    response.cookies.set(ADMIN_SESSION_COOKIE, createAdminSessionCookieValue(), adminSessionCookieOptions());
  } else {
    response.cookies.set(ADMIN_SESSION_COOKIE, "", expiredAdminSessionCookieOptions());
  }
}

export async function GET(request: NextRequest) {
  const user = await appUserFromRequest(request);
  const response = NextResponse.json({ authenticated: Boolean(user), user });
  if (user) applyRoleCookie(response, user.role);
  return response;
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(requestClientKey(request, "app-login"), { limit: 10, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many login attempts. Try again shortly." }, { status: 429 });
  }
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as { password?: unknown; username?: unknown };
  const user = await authenticateAppUser(payload.username, payload.password);
  if (!user) return NextResponse.json({ error: "Login failed. Check your username and password." }, { status: 401 });
  const response = NextResponse.json({ authenticated: true, user });
  setAppSessionCookie(response, user);
  applyRoleCookie(response, user.role);
  return response;
}

export async function DELETE(request: NextRequest) {
  const user = await appUserFromRequest(request);
  if (user) await removeAppPresence(user.id);
  const response = NextResponse.json({ ok: true });
  clearAppSessionCookie(response);
  response.cookies.set(ADMIN_SESSION_COOKIE, "", expiredAdminSessionCookieOptions());
  return response;
}
