import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  deleteStoredProjectXConnection,
  getStoredProjectXConnection,
  projectXConnectionStoreMode,
  saveStoredProjectXConnection
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
  apiKey?: unknown;
  userName?: unknown;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function connectionIdFromRequest(request: NextRequest): string | undefined {
  const value = request.cookies.get(TOPSTEP_PROJECTX_CONNECTION_COOKIE)?.value?.trim();
  return value && /^[0-9A-Za-z_-]{16,80}$/.test(value) ? value : undefined;
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

async function connectedStatus(connectionId: string): Promise<{ status: ProjectXConnectionStatus; refreshedToken?: string }> {
  const connection = await getStoredProjectXConnection(connectionId);
  if (!connection) {
    return {
      status: {
        accounts: [],
        connected: false,
        persisted: false
      }
    };
  }

  const refreshedToken = await validateProjectXSession(connection.token);
  const activeToken = refreshedToken ?? connection.token;
  const accounts = await searchProjectXAccounts(activeToken, true);
  await saveStoredProjectXConnection({
    accounts,
    connectedAt: connection.connectedAt,
    id: connectionId,
    token: activeToken,
    userName: connection.userName
  });

  return {
    status: {
      accounts,
      checkedAt: new Date().toISOString(),
      connected: true,
      persisted: true,
      refreshed: Boolean(refreshedToken),
      userName: connection.userName
    },
    refreshedToken
  };
}

export async function GET(request: NextRequest) {
  const connectionId = connectionIdFromRequest(request);
  if (!connectionId) {
    return jsonStatus({
      accounts: [],
      connected: false,
      persisted: false
    });
  }

  try {
    const result = await connectedStatus(connectionId);
    const response = jsonStatus(result.status);
    setConnectionCookie(response, connectionId);
    return response;
  } catch (error) {
    await deleteStoredProjectXConnection(connectionId).catch(() => undefined);
    const response = jsonStatus({
      accounts: [],
      connected: false,
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

  if (!userName || !apiKey) {
    return jsonStatus(
      {
        accounts: [],
        connected: false,
        error: "Enter both the TopstepX username and API key.",
        persisted: false
      },
      { status: 400 }
    );
  }

  try {
    const connectionId = connectionIdFromRequest(request) ?? randomUUID();
    const token = await loginProjectXApiKey(userName, apiKey);
    const accounts = await searchProjectXAccounts(token, true);
    await saveStoredProjectXConnection({
      accounts,
      id: connectionId,
      token,
      userName
    });
    const response = jsonStatus({
      accounts,
      checkedAt: new Date().toISOString(),
      connected: true,
      persisted: true,
      userName
    });
    setConnectionCookie(response, connectionId);
    return response;
  } catch (error) {
    return jsonStatus(
      {
        accounts: [],
        connected: false,
        error: readableProjectXError(error),
        persisted: false
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const connectionId = connectionIdFromRequest(request);
  if (connectionId) {
    await deleteStoredProjectXConnection(connectionId);
  }

  const response = jsonStatus({
    accounts: [],
    connected: false,
    persisted: false
  });
  clearConnectionCookie(response);
  return response;
}
