import { NextResponse, type NextRequest } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-api";
import { listAutoTradeConnectionsForProvider } from "@/lib/auto-trade-connections";
import { mt5BridgeAccountId, mt5HeartbeatMismatch } from "@/lib/mt5-ea-account";
import { availableMt5ConnectionMode, storedMt5ConnectionMode } from "@/lib/mt5-connection-mode";
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

  const connections = await listAutoTradeConnectionsForProvider("mt5_ea").catch(() => []);
  const requestedConnectionId = request.nextUrl.searchParams.get("connectionId")?.trim();
  const requestedAccount = request.nextUrl.searchParams.get("account")?.trim();
  const connection = connections.find((item) => item.id === requestedConnectionId)
    ?? connections.find((item) => item.accountId === requestedAccount || item.fields.login === requestedAccount)
    ?? connections[0]
    ?? null;
  const account = requestedAccount || mt5BridgeAccountId(connection?.fields);
  const executionMode = connection
    ? storedMt5ConnectionMode(connection.fields)
    : availableMt5ConnectionMode() ?? "terminal_ea";
  const backendConfigured = mt5EaConfigured();
  const provider = process.env.AUTO_TRADE_FOREX_PROVIDER?.trim() || null;
  const providerSelected = provider === "mt5_ea" || (!provider && connections.length > 0);
  const connectedAccounts = connections.map((item) => ({
    accountName: item.accountName,
    connectionId: item.id,
    eaConnectionId: item.fields.bridgeAccountId ?? item.accountId,
    firmLabel: item.firmLabel,
    login: item.fields.login,
    paused: item.paused,
    server: item.fields.server
  }));
  const connectedAccount = connection
    ? {
        accountName: connection.accountName,
        connectionId: connection.id,
        eaConnectionId: connection.fields.bridgeAccountId ?? connection.accountId,
        firmLabel: connection.firmLabel,
        login: connection.fields.login,
        paused: connection.paused,
        server: connection.fields.server
      }
    : null;
  const configuration = {
    backendConfigured,
    configured: backendConfigured && providerSelected && connections.some((item) => !item.paused),
    connectedAccount,
    connectedAccounts,
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
