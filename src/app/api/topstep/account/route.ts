import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-api";
import { verifyStoredProjectXConnectionAccessCode, getStoredProjectXConnection, markStoredProjectXConnectionExpired, saveStoredProjectXConnection } from "@/lib/projectx-connections";
import {
  readableProjectXError,
  searchProjectXAccounts,
  searchProjectXOpenPositions,
  searchProjectXOrders,
  searchProjectXTrades,
  validateProjectXSession
} from "@/lib/projectx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_HISTORY_DAYS = 14;
const MAX_HISTORY_DAYS = 60;

function normalizeConnectionId(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9A-Za-z_-]{16,80}$/.test(value.trim()) ? value.trim() : undefined;
}

function normalizeAccessCode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

function requestedHistoryDays(request: NextRequest): number {
  const value = Number(request.nextUrl.searchParams.get("days"));
  return Number.isFinite(value) && value > 0 ? Math.min(MAX_HISTORY_DAYS, Math.round(value)) : DEFAULT_HISTORY_DAYS;
}

function newestFirst<T extends { creationTimestamp?: string; updateTimestamp?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const rightTime = Date.parse(right.updateTimestamp ?? right.creationTimestamp ?? "");
    const leftTime = Date.parse(left.updateTimestamp ?? left.creationTimestamp ?? "");
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

export async function GET(request: NextRequest) {
  const connectionId = normalizeConnectionId(request.nextUrl.searchParams.get("connectionId"));
  const accountId = Number(request.nextUrl.searchParams.get("accountId"));
  if (!connectionId || !Number.isInteger(accountId)) {
    return jsonError("Choose a ProjectX account.", 400);
  }

  if (!isAdminAuthorized(request)) {
    const accessCode = normalizeAccessCode(request.nextUrl.searchParams.get("accessCode"));
    if (!accessCode || !(await verifyStoredProjectXConnectionAccessCode(connectionId, accessCode))) {
      return jsonError("Unlock this ProjectX folder before viewing account details.", 401);
    }
  }

  const connection = await getStoredProjectXConnection(connectionId);
  if (!connection) return jsonError("ProjectX account folder was not found.", 404);
  if (connection.status !== "connected") return jsonError("Reconnect this ProjectX account folder.", 409);

  const visibleStoredAccounts = connection.accounts.filter((account) => !(connection.removedAccountIds ?? []).includes(account.id));
  if (!visibleStoredAccounts.some((account) => account.id === accountId)) {
    return jsonError("ProjectX account is no longer connected.", 404);
  }

  let activeToken = connection.token;
  let refreshedToken: string | undefined;
  try {
    refreshedToken = await validateProjectXSession(connection.token);
    activeToken = refreshedToken ?? connection.token;
  } catch (error) {
    await markStoredProjectXConnectionExpired(connectionId).catch(() => null);
    return jsonError(`Reconnect this ProjectX account folder. ${readableProjectXError(error)}`, 401);
  }

  try {
    const accounts = await searchProjectXAccounts(activeToken, true);
    const visibleAccounts = accounts.filter((account) => !(connection.removedAccountIds ?? []).includes(account.id));
    const account = visibleAccounts.find((item) => item.id === accountId);
    if (!account) return jsonError("ProjectX account is no longer visible.", 404);

    await saveStoredProjectXConnection({
      accessCodeHash: connection.accessCodeHash,
      accounts: visibleAccounts,
      autoTradePaused: connection.autoTradePaused,
      connectedAt: connection.connectedAt,
      displayName: connection.displayName,
      id: connectionId,
      pausedAccountIds: connection.pausedAccountIds,
      removedAccountIds: connection.removedAccountIds,
      token: activeToken,
      userName: connection.userName
    });

    const historyDays = requestedHistoryDays(request);
    const historyEnd = new Date();
    const historyStart = new Date(historyEnd.getTime() - historyDays * 24 * 60 * 60_000);
    const historyRequest = {
      accountId,
      startTimestamp: historyStart.toISOString(),
      endTimestamp: historyEnd.toISOString()
    };

    const [openPositions, orders, trades] = await Promise.all([
      searchProjectXOpenPositions(activeToken, accountId),
      searchProjectXOrders(activeToken, historyRequest),
      searchProjectXTrades(activeToken, historyRequest)
    ]);

    return NextResponse.json({
      account,
      checkedAt: new Date().toISOString(),
      historyDays,
      historyEnd: historyEnd.toISOString(),
      historyStart: historyStart.toISOString(),
      openPositions: newestFirst(openPositions).slice(0, 25),
      orders: newestFirst(orders).slice(0, 80),
      refreshed: Boolean(refreshedToken),
      trades: newestFirst(trades).slice(0, 80)
    });
  } catch (error) {
    return jsonError(readableProjectXError(error), 502);
  }
}
