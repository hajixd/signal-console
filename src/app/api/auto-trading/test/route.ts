import { NextRequest, NextResponse } from "next/server";
import { parseAutoTradeProviderId } from "@/lib/auto-trade-connections";
import { executeAutoTradeTest } from "@/lib/auto-trader";
import { checkRateLimit, requestClientKey } from "@/lib/request-throttle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TestPayload = {
  accountId?: unknown;
  connectionId?: unknown;
  providerId?: unknown;
};

function normalizeConnectionId(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9A-Za-z_-]{3,80}$/.test(value.trim()) ? value.trim() : undefined;
}

function normalizeAccountId(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(requestClientKey(request, "auto-trade-test"), { limit: 6, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many auto-trade test attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? 60) } }
    );
  }

  const payload = ((await request.json().catch(() => ({}))) ?? {}) as TestPayload;
  const providerId = parseAutoTradeProviderId(payload.providerId);
  if (!providerId) {
    return NextResponse.json({ error: "Choose a supported auto-trade provider to test." }, { status: 400 });
  }

  const result = await executeAutoTradeTest({
    accountId: normalizeAccountId(payload.accountId),
    connectionId: normalizeConnectionId(payload.connectionId),
    providerId
  });

  return NextResponse.json(result, { status: result.status === "failed" ? 400 : 200 });
}
