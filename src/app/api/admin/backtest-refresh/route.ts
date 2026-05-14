import { NextResponse } from "next/server";
import {
  dispatchBacktestRefresh,
  getBacktestRefreshConfigStatus,
  listBacktestRefreshWorkflowRuns,
  verifyBacktestRefreshWorkflowAccess
} from "@/lib/backtest-refresh";
import { isAdminAuthorized } from "@/lib/admin-api";
import { getBacktestCatalogFreshness } from "@/lib/backtest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const includeRuns = url.searchParams.get("runs") === "1";
  const [freshness, verification, runs] = await Promise.all([
    getBacktestCatalogFreshness(),
    url.searchParams.get("verify") === "1" ? verifyBacktestRefreshWorkflowAccess() : Promise.resolve(null),
    includeRuns ? listBacktestRefreshWorkflowRuns() : Promise.resolve(null)
  ]);

  return NextResponse.json({
    config: getBacktestRefreshConfigStatus(),
    freshness,
    route: "/api/admin/backtest-refresh",
    runs,
    verification
  });
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await dispatchBacktestRefresh("admin");
  return NextResponse.json(result.body, { status: result.ok ? result.status : result.status || 500 });
}
