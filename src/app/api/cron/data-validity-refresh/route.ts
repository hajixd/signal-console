import { NextRequest, NextResponse } from "next/server";
import { dispatchBacktestRefresh } from "@/lib/backtest-refresh";
import { updateDatasetSyncRunStatus } from "@/lib/live-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown data validity refresh error";
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
  const startedAtIso = new Date(startedAt).toISOString();
  await updateDatasetSyncRunStatus("dataValidityRefresh", {
    error: undefined,
    finishedAt: undefined,
    startedAt: startedAtIso,
    state: "running"
  }).catch((error) => console.error("Failed to mark data validity refresh running", error));

  try {
    const result = await dispatchBacktestRefresh("data-validity-refresh");
    const durationMs = Date.now() - startedAt;
    const failed = !result.ok || result.status >= 400;

    if (failed) {
      await updateDatasetSyncRunStatus("dataValidityRefresh", {
        durationMs,
        error: `Refresh returned status ${result.status}`,
        finishedAt: new Date().toISOString(),
        startedAt: startedAtIso,
        state: "failed"
      }).catch((error) => console.error("Failed to mark data validity refresh failed", error));
    }

    console.info("data-validity-refresh cron completed", {
      durationMs,
      ok: result.ok,
      status: result.status
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = errorMessage(error);
    await updateDatasetSyncRunStatus("dataValidityRefresh", {
      durationMs,
      error: message,
      finishedAt: new Date().toISOString(),
      startedAt: startedAtIso,
      state: "failed"
    }).catch((statusError) => console.error("Failed to mark data validity refresh failed", statusError));
    console.error("data-validity-refresh cron failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
