import { NextResponse, type NextRequest } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-api";
import { getAutoTradeConnection } from "@/lib/auto-trade-connections";
import { mt5BridgeAccountId, mt5HeartbeatMismatch } from "@/lib/mt5-ea-account";
import { mt5CredentialBridgeConfigured, verifyMt5CredentialConnection } from "@/lib/mt5-credential-bridge";
import { eaIngestToken, mt5EaConfigured } from "@/lib/mt5-ea-queue";
import { getAccountState, getHeartbeat, getMt5ExecutionStats, listMt5Orders } from "@/lib/mt5-ea-state";
import { tursoConfigured } from "@/lib/turso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/auto-trading/mt5-ea-status — read-only EA telemetry for the dashboard.
export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const connection = await getAutoTradeConnection("mt5_ea").catch(() => null);
  const requestedAccount = request.nextUrl.searchParams.get("account")?.trim();
  const account = requestedAccount || mt5BridgeAccountId(connection?.fields);
  const executionMode = connection?.fields.password ? "credential_bridge" as const : "terminal_ea" as const;
  const backendConfigured = executionMode === "credential_bridge" ? mt5CredentialBridgeConfigured() : mt5EaConfigured();
  const provider = process.env.AUTO_TRADE_FOREX_PROVIDER?.trim() || null;
  const providerSelected = provider === "mt5_ea" || (!provider && Boolean(connection));
  const connectedAccount = connection
    ? {
        accountName: connection.accountName,
        firmLabel: connection.firmLabel,
        login: connection.fields.login,
        paused: connection.paused,
        server: connection.fields.server
      }
    : null;
  const configuration = {
    backendConfigured,
    configured: backendConfigured && providerSelected && connection?.paused !== true,
    connectedAccount,
    executionMode,
    provider,
    providerSelected,
    storageConfigured: executionMode === "credential_bridge" || tursoConfigured(),
    tokenConfigured: executionMode === "credential_bridge" || Boolean(eaIngestToken())
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

  if (executionMode === "credential_bridge" && connection) {
    try {
      const verification = await verifyMt5CredentialConnection(connection.fields);
      return NextResponse.json({
        ...configuration,
        accountMismatch: null,
        bridgeAccountId: account,
        credentialVerified: true,
        heartbeat: null,
        orders: [],
        state: { balance: verification.balance, equity: verification.equity },
        stats: null
      });
    } catch (error: unknown) {
      return NextResponse.json({
        ...configuration,
        bridgeAccountId: account,
        credentialVerified: false,
        error: error instanceof Error ? error.message : String(error),
        heartbeat: null,
        orders: [],
        state: null,
        stats: null
      });
    }
  }

  try {
    const [heartbeat, state, stats, orders] = await Promise.all([
      getHeartbeat(account),
      getAccountState(account),
      getMt5ExecutionStats(account),
      listMt5Orders(account, 50)
    ]);
    return NextResponse.json({
      ...configuration,
      accountMismatch: connection ? mt5HeartbeatMismatch(connection.fields, heartbeat) : null,
      bridgeAccountId: account,
      heartbeat,
      state,
      stats,
      orders
    });
  } catch (error) {
    return NextResponse.json(
      { ...configuration, bridgeAccountId: account, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
