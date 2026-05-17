import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  createAdminSessionCookieValue,
  expiredAdminSessionCookieOptions,
  isAdminAuthorized,
  verifyAdminAccessCode
} from "@/lib/admin-api";
import { normalizeAccessCode } from "@/lib/account-access-code";
import { parseAutoTradeProviderId, verifyAutoTradeConnectionAccessCode } from "@/lib/auto-trade-connections";
import { verifyStoredProjectXConnectionAccessCode } from "@/lib/projectx-connections";
import { checkRateLimit, requestClientKey } from "@/lib/request-throttle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AccessCodePayload = {
  accessCode?: unknown;
  connectionId?: unknown;
  providerId?: unknown;
  type?: unknown;
};

function normalizeConnectionId(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9A-Za-z_-]{16,80}$/.test(value.trim()) ? value.trim() : undefined;
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ admin: isAdminAuthorized(request) });
}

export async function POST(request: NextRequest) {
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as AccessCodePayload;
  const accessCode = normalizeAccessCode(payload.accessCode);
  const rateLimit = checkRateLimit(requestClientKey(request, `access-code:${String(payload.type ?? "unknown")}`), { limit: 8, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many code attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } }
    );
  }

  if (payload.type === "admin") {
    if (!verifyAdminAccessCode(accessCode)) {
      return NextResponse.json({ error: "Incorrect code." }, { status: 401 });
    }

    try {
      const response = NextResponse.json({ ok: true });
      response.cookies.set(ADMIN_SESSION_COOKIE, createAdminSessionCookieValue(), adminSessionCookieOptions());
      return response;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Admin sessions are not configured." },
        { status: 500 }
      );
    }
  }

  if (payload.type === "projectx") {
    const connectionId = normalizeConnectionId(payload.connectionId);
    if (!connectionId) {
      return NextResponse.json({ error: "Choose a ProjectX account folder." }, { status: 400 });
    }

    if (await verifyStoredProjectXConnectionAccessCode(connectionId, accessCode)) {
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Incorrect code." }, { status: 401 });
  }

  if (payload.type === "provider") {
    const providerId = parseAutoTradeProviderId(payload.providerId);
    if (!providerId) {
      return NextResponse.json({ error: "Choose a connected auto-trade provider." }, { status: 400 });
    }

    if (await verifyAutoTradeConnectionAccessCode(providerId, accessCode)) {
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Incorrect code." }, { status: 401 });
  }

  return NextResponse.json({ error: "Choose an account type to unlock." }, { status: 400 });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", expiredAdminSessionCookieOptions());
  return response;
}
