import { NextResponse, type NextRequest } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-api";
import { eaIngestToken, mt5EaConfigured } from "@/lib/mt5-ea-queue";
import { getAccountState, getHeartbeat, getMt5ExecutionStats, listMt5Orders } from "@/lib/mt5-ea-state";
import { tursoConfigured } from "@/lib/turso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_BRIDGE_ACCOUNT_ID = "mt5-demo-100k";

function bridgeAccountId(request: NextRequest): string {
  return (
    request.nextUrl.searchParams.get("account")?.trim() ||
    process.env.MT5_EA_DEMO_ACCOUNT_ID?.trim() ||
    DEFAULT_BRIDGE_ACCOUNT_ID
  );
}

// GET /api/auto-trading/mt5-ea-status — read-only EA telemetry for the dashboard.
export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const account = bridgeAccountId(request);
  const backendConfigured = mt5EaConfigured();
  const provider = process.env.AUTO_TRADE_FOREX_PROVIDER?.trim() || null;
  const providerSelected = provider === "mt5_ea";
  const configuration = {
    backendConfigured,
    configured: backendConfigured && providerSelected,
    provider,
    providerSelected,
    storageConfigured: tursoConfigured(),
    tokenConfigured: Boolean(eaIngestToken())
  };

  if (!backendConfigured) {
    return NextResponse.json({
      ...configuration,
      bridgeAccountId: account,
      heartbeat: null,
      state: null,
      stats: null,
      orders: []
    });
  }

  try {
    const [heartbeat, state, stats, orders] = await Promise.all([
      getHeartbeat(account),
      getAccountState(account),
      getMt5ExecutionStats(account),
      listMt5Orders(account, 50)
    ]);
    return NextResponse.json({ ...configuration, bridgeAccountId: account, heartbeat, state, stats, orders });
  } catch (error) {
    return NextResponse.json(
      { ...configuration, bridgeAccountId: account, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
