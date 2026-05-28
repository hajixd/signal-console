import { NextRequest, NextResponse } from "next/server";
import { getBacktestStats, getBacktestTrades, getStrategyCatalog } from "@/lib/backtest";
import { analyzeBacktestDataValidity } from "@/lib/data-validity";
import { getDatasetStatus, updateDatasetSyncRunStatus } from "@/lib/live-config";
import { cronWeekendPause } from "@/lib/market-schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown data validity review error";
}

function failureSummary(result: ReturnType<typeof analyzeBacktestDataValidity>): string | undefined {
  if (result.tone !== "bad") return undefined;
  return result.issues
    .filter((issue) => issue.tone === "bad")
    .slice(0, 4)
    .map((issue) => `${issue.label}: ${issue.count}`)
    .join("; ");
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
      route: "/api/cron/review-validity"
    });
  }
  const weekendPause = cronWeekendPause();
  if (weekendPause.paused) {
    return NextResponse.json({
      ok: true,
      route: "/api/cron/review-validity",
      skipped: true,
      weekendPause
    });
  }

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  await updateDatasetSyncRunStatus("dataValidityRefresh", {
    error: undefined,
    finishedAt: undefined,
    startedAt: startedAtIso,
    state: "running"
  }).catch((error) => console.error("Failed to mark review validity running", error));

  try {
    const [strategyCatalog, backtestStats, backtestTrades, datasetStatus] = await Promise.all([
      getStrategyCatalog(),
      getBacktestStats(),
      getBacktestTrades(),
      getDatasetStatus()
    ]);
    const statsByDatasetId = new Map(backtestStats.map((stat) => [stat.datasetId, stat]));
    const strategyRefs = strategyCatalog.map((entry) => ({
      assetKey: entry.assetKey,
      datasetId: entry.key,
      key: entry.key,
      sizeMultiplier: statsByDatasetId.get(entry.key)?.sizeMultiplier,
      symbol: entry.symbol,
      timeframes: entry.timeframes
    }));
    const result = analyzeBacktestDataValidity({
      assetCoverage: datasetStatus?.assetCoverage,
      backtestBehindMarketData: false,
      strategyRefs,
      trades: backtestTrades
    });
    const durationMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();
    const failed = result.tone === "bad";
    const error = failureSummary(result);

    await updateDatasetSyncRunStatus("dataValidityRefresh", {
      durationMs,
      error,
      finishedAt,
      jobsLastRun: result.stats.tradesChecked,
      startedAt: startedAtIso,
      state: failed ? "failed" : "success"
    }).catch((statusError) => console.error("Failed to mark review validity finished", statusError));

    console.info("review-validity cron completed", {
      badIssues: result.stats.badIssueCount,
      durationMs,
      issues: result.issues.length,
      status: result.label,
      tone: result.tone,
      tradesChecked: result.stats.tradesChecked,
      warningIssues: result.stats.warningIssueCount
    });

    return NextResponse.json({
      ok: !failed,
      result,
      route: "/api/cron/review-validity"
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = errorMessage(error);
    await updateDatasetSyncRunStatus("dataValidityRefresh", {
      durationMs,
      error: message,
      finishedAt: new Date().toISOString(),
      startedAt: startedAtIso,
      state: "failed"
    }).catch((statusError) => console.error("Failed to mark review validity failed", statusError));
    console.error("review-validity cron failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
