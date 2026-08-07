import { NextRequest, NextResponse } from "next/server";
import { createAppUser } from "@/lib/app-auth";
import { setAppSessionCookie } from "@/lib/app-session";
import { ADMIN_SESSION_COOKIE, adminSessionCookieOptions, createAdminSessionCookieValue } from "@/lib/admin-api";
import { checkRateLimit, requestClientKey } from "@/lib/request-throttle";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(requestClientKey(request, "app-register"), { limit: 5, windowMs: 5 * 60_000 });
  if (!rateLimit.allowed) return NextResponse.json({ error: "Too many account attempts. Try again shortly." }, { status: 429 });
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as { password?: unknown; username?: unknown };
  try {
    const user = await createAppUser(payload.username, payload.password);
    const response = NextResponse.json({ authenticated: true, user });
    setAppSessionCookie(response, user);
    if (user.role === "admin") {
      response.cookies.set(ADMIN_SESSION_COOKIE, createAdminSessionCookieValue(), adminSessionCookieOptions());
    }
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Account creation failed." }, { status: 400 });
  }
}
