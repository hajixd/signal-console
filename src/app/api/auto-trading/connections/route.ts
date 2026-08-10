import { NextRequest, NextResponse } from "next/server";
import { isValidAccessCode } from "@/lib/account-access-code";
import { isAdminAuthorized } from "@/lib/admin-api";
import {
  autoTradeConnectionStoreMode,
  deleteAutoTradeConnection,
  getAutoTradeConnectionById,
  listAutoTradeConnections,
  parseAutoTradeProviderId,
  saveAutoTradeConnection,
  setAutoTradeConnectionPaused,
  verifyAutoTradeConnectionAccessCode
} from "@/lib/auto-trade-connections";
import { autoTradeProviderById } from "@/lib/auto-trade-platforms";
import { fieldsForMt5ConnectionMode } from "@/lib/mt5-connection-mode";
import { mt5CredentialBridgeConfigured, verifyMt5CredentialConnection } from "@/lib/mt5-credential-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SavePayload = {
  accessCode?: unknown;
  accountId?: unknown;
  accountName?: unknown;
  fields?: unknown;
  firmId?: unknown;
  firmLabel?: unknown;
  providerId?: unknown;
};

type PatchPayload = {
  accessCode?: unknown;
  connectionId?: unknown;
  paused?: unknown;
  providerId?: unknown;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, fieldValue]) => [key, text(fieldValue)])
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
  );
}

function adminRequired() {
  return NextResponse.json({ error: "Admin access required." }, { status: 401 });
}

function connectionId(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9A-Za-z_-]{3,80}$/.test(value.trim()) ? value.trim() : undefined;
}

function mt5ConnectionMode(): "credential_bridge" | null {
  return mt5CredentialBridgeConfigured() ? "credential_bridge" : null;
}

async function authorizeProviderMutation(request: NextRequest, savedConnectionId: string, accessCode: unknown) {
  if (isAdminAuthorized(request)) return null;
  const suppliedCode = text(accessCode) ?? text(request.nextUrl.searchParams.get("accessCode"));
  if (suppliedCode && await verifyAutoTradeConnectionAccessCode(savedConnectionId, suppliedCode)) return null;
  return adminRequired();
}

function publicConnection(connection: Awaited<ReturnType<typeof listAutoTradeConnections>>[number]) {
  const provider = autoTradeProviderById(connection.providerId);
  return {
    accountId: connection.accountId,
    accountName: connection.accountName,
    checkedAt: connection.lastCheckedAt,
    connected: true,
    connectedAt: connection.connectedAt,
    firmId: connection.firmId,
    firmLabel: connection.firmLabel,
    id: connection.id,
    eaConnectionId: connection.providerId === "mt5_ea" ? connection.fields.bridgeAccountId ?? connection.accountId : undefined,
    marketLabels: provider?.markets ?? [],
    paused: connection.paused,
    providerId: connection.providerId,
    providerLabel: connection.providerLabel,
    storageMode: autoTradeConnectionStoreMode()
  };
}

export async function GET() {
  const connections = await listAutoTradeConnections();
  return NextResponse.json({
    connections: connections.map(publicConnection),
    mt5ConnectionMode: mt5ConnectionMode(),
    storageMode: autoTradeConnectionStoreMode()
  });
}

export async function POST(request: NextRequest) {
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as SavePayload;
  const providerId = parseAutoTradeProviderId(payload.providerId);
  if (!providerId) {
    return NextResponse.json({ error: "Choose a supported auto-trade provider." }, { status: 400 });
  }

  let fields = cleanFields(payload.fields);
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Enter the provider credentials before connecting." }, { status: 400 });
  }
  if (providerId === "mt5_ea") {
    if (!fields.login || !/^\d+$/.test(fields.login)) {
      return NextResponse.json({ error: "Enter the numeric MT5 account login issued by the prop firm." }, { status: 400 });
    }
    if (!fields.server) {
      return NextResponse.json({ error: "Enter the exact MT5 broker server issued with the account." }, { status: 400 });
    }
    if (!fields.password) {
      return NextResponse.json({ error: "Enter the MT5 master trading password issued by the prop firm." }, { status: 400 });
    }
    fields.bridgeAccountId = fields.login;
  }

  const accessCode = text(payload.accessCode);
  if (!isValidAccessCode(accessCode)) {
    return NextResponse.json({ error: "Create a 5-digit account code." }, { status: 400 });
  }
  let accountName = text(payload.accountName);
  if (!accountName && providerId !== "mt5_ea") {
    return NextResponse.json({ error: "Enter a name for this auto-trading account." }, { status: 400 });
  }

  if (providerId === "mt5_ea") {
    const connectionMode = mt5ConnectionMode();
    if (!connectionMode) {
      return NextResponse.json(
        { error: "The secure MT5 credential service is not online yet." },
        { status: 503 }
      );
    }
    if (connectionMode === "credential_bridge") {
      try {
        const verification = await verifyMt5CredentialConnection(fields);
        accountName ||= verification.accountName?.trim();
        if (typeof verification.balance === "number" && Number.isFinite(verification.balance) && verification.balance > 0) {
          fields.accountSize = String(verification.balance);
        }
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "MT5 could not verify this account." }, { status: 400 });
      }
    }
    accountName ||= `${text(payload.firmLabel) ?? "MT5"} ${fields.login}`;
    fields = fieldsForMt5ConnectionMode(fields, connectionMode);
  }

  if (!accountName) {
    return NextResponse.json({ error: "Enter a name for this auto-trading account." }, { status: 400 });
  }

  try {
    const connection = await saveAutoTradeConnection({
      accessCode,
      accountId: providerId === "mt5_ea" ? fields.login : text(payload.accountId),
      accountName,
      fields,
      firmId: text(payload.firmId),
      firmLabel: text(payload.firmLabel),
      providerId
    });
    return NextResponse.json({
      connection: publicConnection(connection),
      connections: (await listAutoTradeConnections()).map(publicConnection),
      mt5ConnectionMode: mt5ConnectionMode(),
      storageMode: autoTradeConnectionStoreMode()
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Auto-trade connection failed." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as PatchPayload;
  const providerId = parseAutoTradeProviderId(payload.providerId);
  if (!providerId) {
    return NextResponse.json({ error: "Choose a supported auto-trade provider." }, { status: 400 });
  }

  const savedConnectionId = connectionId(payload.connectionId) ?? providerId;
  const savedConnection = await getAutoTradeConnectionById(savedConnectionId);
  if (!savedConnection || savedConnection.providerId !== providerId) {
    return NextResponse.json({ error: "Auto-trade provider is not connected." }, { status: 404 });
  }
  const connection = await setAutoTradeConnectionPaused(savedConnectionId, payload.paused !== false);
  if (!connection) {
    return NextResponse.json({ error: "Auto-trade provider is not connected." }, { status: 404 });
  }
  return NextResponse.json({
    connection: publicConnection(connection),
    connections: (await listAutoTradeConnections()).map(publicConnection),
    mt5ConnectionMode: mt5ConnectionMode(),
    storageMode: autoTradeConnectionStoreMode()
  });
}

export async function DELETE(request: NextRequest) {
  const providerId = parseAutoTradeProviderId(request.nextUrl.searchParams.get("providerId"));
  if (!providerId) {
    return NextResponse.json({ error: "Choose a supported auto-trade provider." }, { status: 400 });
  }
  const savedConnectionId = connectionId(request.nextUrl.searchParams.get("connectionId")) ?? providerId;
  const savedConnection = await getAutoTradeConnectionById(savedConnectionId);
  if (!savedConnection || savedConnection.providerId !== providerId) {
    return NextResponse.json({ error: "Auto-trade provider is not connected." }, { status: 404 });
  }
  const unauthorized = await authorizeProviderMutation(request, savedConnectionId, request.nextUrl.searchParams.get("accessCode"));
  if (unauthorized) return unauthorized;
  await deleteAutoTradeConnection(savedConnectionId);
  return NextResponse.json({
    connections: (await listAutoTradeConnections()).map(publicConnection),
    mt5ConnectionMode: mt5ConnectionMode(),
    storageMode: autoTradeConnectionStoreMode()
  });
}
