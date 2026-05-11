import { NextRequest, NextResponse } from "next/server";
import { updateDatasetSyncRunStatus } from "@/lib/live-config";
import { activeRules } from "@/lib/live-signals";
import { refreshMarketDataForRules } from "@/lib/market-data-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown market data sync error";
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
      route: "/api/cron/market-data-sync"
    });
  }

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  await updateDatasetSyncRunStatus("marketDataSync", {
    error: undefined,
    finishedAt: undefined,
    startedAt: startedAtIso,
    state: "running"
  }).catch((error) => console.error("Failed to mark market data sync running", error));

  try {
    const rules = await activeRules();
    if (!rules.length) {
      throw new Error("No active live strategies are enabled for market data sync.");
    }

    const result = await refreshMarketDataForRules(rules);
    const durationMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();
    const failed = result.summary.errors.length > 0 || result.summary.assets.length === 0;
    const failureMessage = result.summary.errors.length
      ? result.summary.errors.map((entry) => `${entry.symbol}: ${entry.message}`).join("; ")
      : "No market data assets were refreshed.";

    await updateDatasetSyncRunStatus("marketDataSync", {
      durationMs,
      error: failed ? failureMessage : undefined,
      finishedAt,
      startedAt: startedAtIso,
      state: failed ? "failed" : "success"
    }).catch((error) => console.error("Failed to mark market data sync finished", error));

    console.info("market-data-sync cron completed", {
      assetTimings: result.summary.assets.map((asset) => ({
        appendedRows: asset.appendedRows,
        durationMs: asset.durationMs,
        symbol: asset.symbol,
        uploadedFiles: asset.uploadedFiles
      })),
      assets: result.summary.assets.length,
      durationMs,
      errors: result.summary.errors.length,
      totalDurationMs: result.summary.totalDurationMs,
      uploadedFiles: result.summary.uploadedFiles
    });

    return NextResponse.json({
      rules: rules.length,
      ...result.summary
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = errorMessage(error);
    await updateDatasetSyncRunStatus("marketDataSync", {
      durationMs,
      error: message,
      finishedAt: new Date().toISOString(),
      startedAt: startedAtIso,
      state: "failed"
    }).catch((statusError) => console.error("Failed to mark market data sync failed", statusError));
    console.error("market-data-sync cron failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
