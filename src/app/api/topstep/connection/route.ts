import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isValidAccessCode } from "@/lib/account-access-code";
import { isAdminAuthorized } from "@/lib/admin-api";
import {
  deleteStoredProjectXConnection,
  getLatestStoredProjectXConnection,
  getStoredProjectXConnectionSummaries,
  getStoredProjectXConnection,
  projectXConnectionStoreMode,
  saveStoredProjectXConnection,
  removeStoredProjectXConnectionAccount,
  setStoredProjectXConnectionAccessCode,
  setStoredProjectXConnectionPaused,
  verifyStoredProjectXConnectionAccessCode
} from "@/lib/projectx-connections";
import {
  loginProjectXApiKey,
  readableProjectXError,
  searchProjectXAccounts,
  validateProjectXSession,
  type ProjectXConnectionStatus
} from "@/lib/projectx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOPSTEP_PROJECTX_CONNECTION_COOKIE = "topstep_projectx_connection_id";
const CONNECTION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

type ConnectPayload = {
  accessCode?: unknown;
  apiKey?: unknown;
  connectionId?: unknown;
  userName?: unknown;
};

type UpdatePayload = {
  accessCode?: unknown;
  accountId?: unknown;
  autoTradePaused?: unknown;
  connectionId?: unknown;
  newAccessCode?: unknown;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function adminRequired() {
  return jsonStatus({ accounts: [], autoTradePaused: true, connected: false, error: "Admin access required.", persisted: false }, { status: 401 });
}

function connectionIdFromRequest(request: NextRequest): string | undefined {
  const value = request.cookies.get(TOPSTEP_PROJECTX_CONNECTION_COOKIE)?.value?.trim();
  return value && /^[0-9A-Za-z_-]{16,80}$/.test(value) ? value : undefined;
}

function normalizeConnectionId(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9A-Za-z_-]{16,80}$/.test(value.trim()) ? value.trim() : undefined;
}

async function authorizeConnectionMutation(request: NextRequest, connectionId: string, accessCode: unknown) {
  if (isAdminAuthorized(request)) return null;
  const suppliedCode = normalizeText(accessCode) || normalizeText(request.nextUrl.searchParams.get("accessCode"));
  if (suppliedCode && await verifyStoredProjectXConnectionAccessCode(connectionId, suppliedCode)) return null;
  return adminRequired();
}

async function requireCurrentConnectionAccessCode(connectionId: string, accessCode: unknown) {
  const suppliedCode = normalizeText(accessCode);
  if (suppliedCode && await verifyStoredProjectXConnectionAccessCode(connectionId, suppliedCode)) return null;
  return jsonStatus(
    {
      accounts: [],
      autoTradePaused: true,
      connected: false,
      connections: await getStoredProjectXConnectionSummaries(),
      error: "Incorrect current folder code.",
      persisted: false
    },
    { status: 401 }
  );
}

function preferredConnectionId(): string | undefined {
  const value = process.env.PROJECTX_AUTO_TRADE_CONNECTION_ID?.trim();
  return value && /^[0-9A-Za-z_-]{16,80}$/.test(value) ? value : undefined;
}

async function visibleConnectionIdFromRequest(request: NextRequest): Promise<string | undefined> {
  const cookieConnectionId = connectionIdFromRequest(request);
  if (cookieConnectionId) {
    try {
      const connection = await getStoredProjectXConnection(cookieConnectionId);
      if (connection?.status === "connected") return cookieConnectionId;
    } catch {
      // If the cookie points at an unreadable/deleted connection, fall back to the shared Firebase connection.
    }
  }

  return (await getLatestStoredProjectXConnection(preferredConnectionId()))?.id;
}

function setConnectionCookie(response: NextResponse, connectionId: string): void {
  response.cookies.set({
    name: TOPSTEP_PROJECTX_CONNECTION_COOKIE,
    value: connectionId,
    httpOnly: true,
    maxAge: CONNECTION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

function clearConnectionCookie(response: NextResponse): void {
  response.cookies.set({
    name: TOPSTEP_PROJECTX_CONNECTION_COOKIE,
    value: "",
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

function jsonStatus(payload: ProjectXConnectionStatus, init?: ResponseInit): NextResponse {
  return NextResponse.json(
    {
      storageMode: projectXConnectionStoreMode(),
      ...payload
    },
    init
  );
}

async function withConnectionSummaries(status: ProjectXConnectionStatus): Promise<ProjectXConnectionStatus> {
  return {
    ...status,
    connections: await getStoredProjectXConnectionSummaries()
  };
}

async function connectedStatus(connectionId: string): Promise<{ status: ProjectXConnectionStatus; refreshedToken?: string }> {
  const connection = await getStoredProjectXConnection(connectionId);
  if (!connection) {
    return {
      status: await withConnectionSummaries({
        accounts: [],
        autoTradePaused: true,
        connected: false,
        persisted: false
      })
    };
  }

  const refreshedToken = await validateProjectXSession(connection.token);
  const activeToken = refreshedToken ?? connection.token;
  const accounts = await searchProjectXAccounts(activeToken, true);
  const visibleAccounts = accounts.filter((account) => !(connection.removedAccountIds ?? []).includes(account.id));
  const savedConnection = await saveStoredProjectXConnection({
    accessCodeHash: connection.accessCodeHash,
    accounts: visibleAccounts,
    autoTradePaused: connection.autoTradePaused,
    connectedAt: connection.connectedAt,
    id: connectionId,
    pausedAccountIds: connection.pausedAccountIds,
    removedAccountIds: connection.removedAccountIds,
    token: activeToken,
    userName: connection.userName
  });

  return {
    status: {
      accounts: visibleAccounts,
      autoTradePaused: connection.autoTradePaused,
      checkedAt: new Date().toISOString(),
      connected: true,
      connections: await getStoredProjectXConnectionSummaries(),
      pausedAccountIds: savedConnection.pausedAccountIds,
      persisted: true,
      refreshed: Boolean(refreshedToken),
      userName: connection.userName
    },
    refreshedToken
  };
}

export async function GET(request: NextRequest) {
  const connectionId = await visibleConnectionIdFromRequest(request);
  if (!connectionId) {
    return jsonStatus(await withConnectionSummaries({ accounts: [], autoTradePaused: true, connected: false, persisted: false }));
  }

  try {
    const result = await connectedStatus(connectionId);
    const response = jsonStatus(result.status);
    setConnectionCookie(response, connectionId);
    return response;
  } catch (error) {
    const response = jsonStatus({
      accounts: [],
      autoTradePaused: true,
      connected: false,
      connections: await getStoredProjectXConnectionSummaries(),
      error: readableProjectXError(error),
      persisted: false
    });
    clearConnectionCookie(response);
    return response;
  }
}

export async function POST(request: NextRequest) {
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as ConnectPayload;
  const userName = normalizeText(payload.userName);
  const apiKey = normalizeText(payload.apiKey);
  const accessCode = normalizeText(payload.accessCode);

  if (!userName || !apiKey) {
    return jsonStatus(
      {
        accounts: [],
        autoTradePaused: true,
        connected: false,
        connections: await getStoredProjectXConnectionSummaries(),
        error: "Enter both the TopstepX username and API key.",
        persisted: false
      },
      { status: 400 }
    );
  }

  if (!isValidAccessCode(accessCode)) {
    return jsonStatus(
      {
        accounts: [],
        autoTradePaused: true,
        connected: false,
        connections: await getStoredProjectXConnectionSummaries(),
        error: "Create a 5-digit account code.",
        persisted: false
      },
      { status: 400 }
    );
  }

  try {
    const connectionId = normalizeConnectionId(payload.connectionId) ?? randomUUID();
    const token = await loginProjectXApiKey(userName, apiKey);
    const accounts = await searchProjectXAccounts(token, true);
    await saveStoredProjectXConnection({
      accessCode,
      accounts,
      autoTradePaused: true,
      id: connectionId,
      pausedAccountIds: accounts.map((account) => account.id),
      token,
      userName
    });
    const response = jsonStatus({
      accounts,
      autoTradePaused: true,
      checkedAt: new Date().toISOString(),
      connected: true,
      connections: await getStoredProjectXConnectionSummaries(),
      pausedAccountIds: accounts.map((account) => account.id),
      persisted: true,
      userName
    });
    setConnectionCookie(response, connectionId);
    return response;
  } catch (error) {
    return jsonStatus(
      {
        accounts: [],
        autoTradePaused: true,
        connected: false,
        connections: await getStoredProjectXConnectionSummaries(),
        error: readableProjectXError(error),
        persisted: false
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as UpdatePayload;
  const connectionId = normalizeConnectionId(payload.connectionId) ?? connectionIdFromRequest(request);
  if (!connectionId) {
    return jsonStatus(
      {
        accounts: [],
        autoTradePaused: true,
        connected: false,
        connections: await getStoredProjectXConnectionSummaries(),
        error: "Add a ProjectX account before changing auto-trade status.",
        persisted: false
      },
      { status: 400 }
    );
  }

  const newAccessCode = normalizeText(payload.newAccessCode);
  if (newAccessCode) {
    const unauthorized = await requireCurrentConnectionAccessCode(connectionId, payload.accessCode);
    if (unauthorized) return unauthorized;

    if (!isValidAccessCode(newAccessCode)) {
      return jsonStatus(
        {
          accounts: [],
          autoTradePaused: true,
          connected: false,
          connections: await getStoredProjectXConnectionSummaries(),
          error: "Create a 5-digit folder code.",
          persisted: false
        },
        { status: 400 }
      );
    }

    const updated = await setStoredProjectXConnectionAccessCode(connectionId, newAccessCode);
    if (!updated) {
      return jsonStatus(
        {
          accounts: [],
          autoTradePaused: true,
          connected: false,
          connections: await getStoredProjectXConnectionSummaries(),
          error: "ProjectX account folder is no longer connected.",
          persisted: false
        },
        { status: 404 }
      );
    }

    const connection = await getStoredProjectXConnection(connectionId).catch(() => null);
    const response = jsonStatus({
      accounts: connection?.accounts ?? [],
      autoTradePaused: connection?.autoTradePaused ?? true,
      checkedAt: connection?.lastCheckedAt,
      connected: Boolean(connection),
      connections: await getStoredProjectXConnectionSummaries(),
      pausedAccountIds: connection?.pausedAccountIds,
      persisted: true,
      userName: connection?.userName
    });
    setConnectionCookie(response, connectionId);
    return response;
  }

  const autoTradePaused = payload.autoTradePaused === false ? false : true;
  const accountId = typeof payload.accountId === "number" && Number.isInteger(payload.accountId) ? payload.accountId : undefined;

  const connection = await setStoredProjectXConnectionPaused(connectionId, autoTradePaused, accountId);
  if (!connection) {
    const response = jsonStatus(
      {
        accounts: [],
        autoTradePaused: true,
        connected: false,
        connections: await getStoredProjectXConnectionSummaries(),
        error: "ProjectX account is no longer connected.",
        persisted: false
      },
      { status: 404 }
    );
    clearConnectionCookie(response);
    return response;
  }

  const response = jsonStatus({
    accounts: connection.accounts,
    autoTradePaused: connection.autoTradePaused,
    checkedAt: connection.lastCheckedAt,
    connected: true,
    connections: await getStoredProjectXConnectionSummaries(),
    pausedAccountIds: connection.pausedAccountIds,
    persisted: true,
    userName: connection.userName
  });
  setConnectionCookie(response, connectionId);
  return response;
}

export async function DELETE(request: NextRequest) {
  const connectionId = normalizeConnectionId(request.nextUrl.searchParams.get("connectionId")) ?? connectionIdFromRequest(request);
  const accountIdValue = Number(request.nextUrl.searchParams.get("accountId"));
  const accountId = Number.isInteger(accountIdValue) ? accountIdValue : undefined;
  if (connectionId) {
    const unauthorized = request.nextUrl.searchParams.get("connectionId")
      ? await requireCurrentConnectionAccessCode(connectionId, request.nextUrl.searchParams.get("accessCode"))
      : await authorizeConnectionMutation(request, connectionId, request.nextUrl.searchParams.get("accessCode"));
    if (unauthorized) return unauthorized;
    if (typeof accountId === "number") {
      const connection = await removeStoredProjectXConnectionAccount(connectionId, accountId);
      if (!connection) {
        return jsonStatus(
          {
            accounts: [],
            autoTradePaused: true,
            connected: false,
            connections: await getStoredProjectXConnectionSummaries(),
            error: "ProjectX account is no longer connected.",
            persisted: false
          },
          { status: 404 }
        );
      }

      const response = jsonStatus({
        accounts: connection.accounts,
        autoTradePaused: connection.autoTradePaused,
        checkedAt: connection.lastCheckedAt,
        connected: true,
        connections: await getStoredProjectXConnectionSummaries(),
        pausedAccountIds: connection.pausedAccountIds,
        persisted: true,
        userName: connection.userName
      });
      setConnectionCookie(response, connectionId);
      return response;
    }

    await deleteStoredProjectXConnection(connectionId);
  }

  const response = jsonStatus({
    accounts: [],
    autoTradePaused: true,
    connected: false,
    connections: await getStoredProjectXConnectionSummaries(),
    persisted: false
  });
  clearConnectionCookie(response);
  return response;
}
