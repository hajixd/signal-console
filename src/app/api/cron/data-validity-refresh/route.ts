import { NextRequest, NextResponse } from "next/server";
import { dispatchBacktestRefresh } from "@/lib/backtest-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

export async function GET(request: NextRequest) {
  const auth = isAuthorized(request);
  if (auth === "missing-secret") {
    return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500 });
  }
  if (auth === "bad-secret") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get("health") === "1") {
    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      ok: true,
      route: "/api/cron/data-validity-refresh"
    });
  }

  const startedAt = Date.now();
  const result = await dispatchBacktestRefresh("data-validity-refresh");
  console.info("data-validity-refresh cron completed", {
    durationMs: Date.now() - startedAt,
    ok: result.ok,
    status: result.status
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
