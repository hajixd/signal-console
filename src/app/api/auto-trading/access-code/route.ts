import { NextRequest, NextResponse } from "next/server";
import { normalizeAccessCode } from "@/lib/account-access-code";
import { parseAutoTradeProviderId, verifyAutoTradeConnectionAccessCode } from "@/lib/auto-trade-connections";
import { verifyStoredProjectXConnectionAccessCode } from "@/lib/projectx-connections";

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

export async function POST(request: NextRequest) {
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as AccessCodePayload;
  const accessCode = normalizeAccessCode(payload.accessCode);

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
