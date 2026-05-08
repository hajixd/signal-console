import { NextRequest, NextResponse } from "next/server";
import { updateDatasetSyncStatus } from "@/lib/live-config";
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
  const rules = await activeRules();
  const result = await refreshMarketDataForRules(rules);

  if (!result.summary.assets.length && !result.summary.errors.length) {
    await updateDatasetSyncStatus("lastMarketDataSyncAt", result.summary.refreshedAt);
  }

  console.info("market-data-sync cron completed", {
    assets: result.summary.assets.length,
    durationMs: Date.now() - startedAt,
    errors: result.summary.errors.length,
    uploadedFiles: result.summary.uploadedFiles
  });

  return NextResponse.json({
    rules: rules.length,
    ...result.summary
  });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
