import { NextRequest, NextResponse } from "next/server";
import { runSignalCheck } from "@/app/api/cron/check-signals/route";
import { saveCronRun, updateDatasetSyncRunStatus } from "@/lib/live-config";
import { activeRules } from "@/lib/live-signals";
import { cronWeekendPause, marketOpenForSignal } from "@/lib/market-schedule";
import { refreshMarketDataForRulesWithOptions, saveMarketDataRefreshStatus, type MarketDataRefreshResult } from "@/lib/market-data-refresh";

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

type MarketDataSyncError = {
  message: string;
  symbol: string;
};

function cleanProviderMessage(message: string): string {
  return message.replace(/\.\.\.[A-Za-z0-9_-]{4}/g, "...REDACTED");
}

function symbolList(symbols: string[]): string {
  const visible = symbols.slice(0, 12).join(", ");
  return symbols.length > 12 ? `${visible}, +${symbols.length - 12} more` : visible;
}

function marketDataFailureMessage(errors: MarketDataSyncError[], refreshedAssetCount: number): string {
  if (!errors.length) return refreshedAssetCount === 0 ? "No market data assets were refreshed." : "";

  const groups = new Map<string, string[]>();
  for (const entry of errors) {
    const message = cleanProviderMessage(entry.message);
    groups.set(message, [...(groups.get(message) ?? []), entry.symbol]);
  }

  return [...groups.entries()]
    .map(([message, symbols]) => `${symbols.length} asset${symbols.length === 1 ? "" : "s"} (${symbolList(symbols)}): ${message}`)
    .join("; ");
}

async function runSignalCheckAfterMarketDataSync(
  refreshedData: MarketDataRefreshResult
): Promise<{ durationMs: number; error?: string; ok: boolean; status: number }> {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  await updateDatasetSyncRunStatus("signalTradeCheck", {
    error: undefined,
    finishedAt: undefined,
    startedAt: startedAtIso,
    state: "running"
  }).catch((error) => console.error("Failed to mark signal check running", error));

  try {
    const result = await runSignalCheck({ initialBarsByTimeframeKey: refreshedData.barsByAssetTimeframeKey });
    await saveCronRun(result);
    const durationMs = Date.now() - startedAt;
    const failed = result.errors.length > 0;
    await updateDatasetSyncRunStatus("signalTradeCheck", {
      durationMs,
      error: failed ? result.errors.map((entry) => `${entry.symbol}: ${entry.message}`).join("; ") : undefined,
      finishedAt: new Date().toISOString(),
      startedAt: startedAtIso,
      state: failed ? "failed" : "success"
    }).catch((error) => console.error("Failed to mark signal check finished", error));

    return { durationMs, ok: true, status: 200 };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = errorMessage(error);
    await updateDatasetSyncRunStatus("signalTradeCheck", {
      durationMs,
      error: message,
      finishedAt: new Date().toISOString(),
      startedAt: startedAtIso,
      state: "failed"
    }).catch((statusError) => console.error("Failed to mark signal check failed", statusError));
    return { durationMs, error: message, ok: false, status: 500 };
  }
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

  const weekendPause = cronWeekendPause();
  if (weekendPause.paused) {
    return NextResponse.json({
      ok: true,
      route: "/api/cron/market-data-sync",
      skipped: true,
      weekendPause
    });
  }

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();

  let rules: Awaited<ReturnType<typeof activeRules>>;
  try {
    const allRules = await activeRules();
    if (!allRules.length) {
      return NextResponse.json({
        ok: true,
        reason: "No active live strategies are enabled for market data sync.",
        route: "/api/cron/market-data-sync",
        skipped: true
      });
    }

    const sessionReference = new Date();
    rules = allRules.filter((rule) => marketOpenForSignal(rule.market, sessionReference, { assetKey: rule.assetKey, symbol: rule.symbol })?.open ?? false);
    if (!rules.length) {
      return NextResponse.json({
        markets: ["forex", "futures"],
        ok: true,
        reason: "No configured forex or futures market is open for market data sync.",
        route: "/api/cron/market-data-sync",
        skipped: true
      });
    }
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }

  await updateDatasetSyncRunStatus("marketDataSync", {
    error: undefined,
    finishedAt: undefined,
    startedAt: startedAtIso,
    state: "running"
  }).catch((error) => console.error("Failed to mark market data sync running", error));

  try {
    const result = await refreshMarketDataForRulesWithOptions(rules, { saveStatus: false });
    const durationMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();
    const failed = result.summary.errors.length > 0 || result.summary.assets.length === 0;
    const failureMessage = marketDataFailureMessage(result.summary.errors, result.summary.assets.length);
    const signalCheck = failed ? undefined : await runSignalCheckAfterMarketDataSync(result).catch((error) => ({
      durationMs: 0,
      error: errorMessage(error),
      ok: false,
      status: 0
    }));

    await saveMarketDataRefreshStatus(result.summary);

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
      errorSummary: failureMessage || undefined,
      signalCheck,
      totalDurationMs: result.summary.totalDurationMs,
      uploadedFiles: result.summary.uploadedFiles
    });

    return NextResponse.json({
      rules: rules.length,
      signalCheck,
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
