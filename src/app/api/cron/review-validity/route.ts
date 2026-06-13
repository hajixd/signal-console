import { NextRequest, NextResponse } from "next/server";
import { getBacktestStats, getBacktestTrades, getStrategyCatalog } from "@/lib/backtest";
import { analyzeBacktestDataValidity } from "@/lib/data-validity";
import { getDatasetStatus, updateDatasetSyncRunStatus } from "@/lib/live-config";
import { cronWeekendPause } from "@/lib/market-schedule";
import {
  marketDataRefreshErrorSummary,
  refreshMarketDataForAssetKeys,
  saveMarketDataRefreshStatus,
  type MarketDataRefreshSummary
} from "@/lib/market-data-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secrets = [process.env.CRON_SECRET, process.env.APP_ADMIN_SECRET].filter((secret): secret is string => Boolean(secret?.trim()));
  if (!secrets.length) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  const authorization = request.headers.get("authorization");
  return secrets.some((secret) => authorization === `Bearer ${secret}`) ? "ok" : "bad-secret";
}

function forceRunEnabled(request: NextRequest): boolean {
  const value = request.nextUrl.searchParams.get("force")?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
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

type StrategyCoverageRef = {
  assetKey?: string;
  symbol?: string;
  timeframes?: string[];
};

type AssetCoverageRef = NonNullable<Awaited<ReturnType<typeof getDatasetStatus>>>["assetCoverage"];

function requiredCoverageByAsset(strategyRefs: StrategyCoverageRef[]): Map<string, Set<string>> {
  const required = new Map<string, Set<string>>();
  for (const ref of strategyRefs) {
    if (!ref.assetKey) continue;
    const timeframes = required.get(ref.assetKey) ?? new Set<string>();
    for (const timeframe of ref.timeframes?.length ? ref.timeframes : ["15m"]) {
      if (timeframe) timeframes.add(timeframe);
    }
    required.set(ref.assetKey, timeframes);
  }
  return required;
}

function coverageRepairAssetKeys(strategyRefs: StrategyCoverageRef[], assetCoverage: AssetCoverageRef | undefined): string[] {
  const required = requiredCoverageByAsset(strategyRefs);
  const repairKeys: string[] = [];
  for (const [assetKey, timeframes] of required) {
    const coverage = assetCoverage?.[assetKey];
    if (!coverage) {
      repairKeys.push(assetKey);
      continue;
    }
    const coveredTimeframes = new Set(coverage.timeframes ?? []);
    if ([...timeframes].some((timeframe) => !coveredTimeframes.has(timeframe))) {
      repairKeys.push(assetKey);
    }
  }
  return repairKeys;
}

function mergeRefreshCoverage(
  assetCoverage: AssetCoverageRef | undefined,
  summary: MarketDataRefreshSummary
): AssetCoverageRef {
  const merged = {
    ...(assetCoverage ?? {})
  };
  for (const asset of summary.assets) {
    const { appendedRows, assetKey, durationMs, uploadedFiles, ...coverage } = asset;
    void appendedRows;
    void durationMs;
    void uploadedFiles;
    merged[assetKey] = coverage;
  }
  return merged;
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
  const forceRun = forceRunEnabled(request);
  const weekendPause = cronWeekendPause();
  if (weekendPause.paused && !forceRun) {
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
    let assetCoverage = datasetStatus?.assetCoverage;
    let coverageRepair: MarketDataRefreshSummary | undefined;
    let coverageRepairError: string | undefined;
    const repairAssetKeys = coverageRepairAssetKeys(strategyRefs, assetCoverage);
    if (repairAssetKeys.length) {
      try {
        const repairResult = await refreshMarketDataForAssetKeys(repairAssetKeys, { saveStatus: false });
        coverageRepair = repairResult.summary;
        assetCoverage = mergeRefreshCoverage(assetCoverage, repairResult.summary);
        if (repairResult.summary.assets.length) {
          await saveMarketDataRefreshStatus(repairResult.summary);
        }
      } catch (error) {
        coverageRepairError = errorMessage(error);
      }
    }
    const result = analyzeBacktestDataValidity({
      assetCoverage,
      backtestBehindMarketData: false,
      strategyRefs,
      trades: backtestTrades
    });
    const durationMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();
    const failed = result.tone === "bad";
    const coverageRefreshError =
      coverageRepairError ??
      (coverageRepair?.errors.length ? marketDataRefreshErrorSummary(coverageRepair) : undefined);
    const error = [
      failureSummary(result),
      coverageRefreshError ? `Coverage refresh: ${coverageRefreshError}` : undefined
    ].filter(Boolean).join("; ") || undefined;

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
      refreshedCoverageAssets: coverageRepair?.assets.length ?? 0,
      refreshCoverageErrors: coverageRepair?.errors.length ?? (coverageRepairError ? 1 : 0),
      status: result.label,
      tone: result.tone,
      tradesChecked: result.stats.tradesChecked,
      warningIssues: result.stats.warningIssueCount
    });

    return NextResponse.json({
      coverageRepair,
      coverageRepairError,
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
