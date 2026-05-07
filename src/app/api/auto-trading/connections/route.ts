import { NextRequest, NextResponse } from "next/server";
import {
  autoTradeConnectionStoreMode,
  deleteAutoTradeConnection,
  listAutoTradeConnections,
  parseAutoTradeProviderId,
  saveAutoTradeConnection,
  setAutoTradeConnectionPaused
} from "@/lib/auto-trade-connections";
import { autoTradeProviderById } from "@/lib/auto-trade-platforms";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SavePayload = {
  accountId?: unknown;
  accountName?: unknown;
  fields?: unknown;
  providerId?: unknown;
};

type PatchPayload = {
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

function publicConnection(connection: Awaited<ReturnType<typeof listAutoTradeConnections>>[number]) {
  const provider = autoTradeProviderById(connection.id);
  return {
    accountId: connection.accountId,
    accountName: connection.accountName,
    checkedAt: connection.lastCheckedAt,
    connected: true,
    connectedAt: connection.connectedAt,
    id: connection.id,
    marketLabels: provider?.markets ?? [],
    paused: connection.paused,
    providerLabel: connection.providerLabel,
    storageMode: autoTradeConnectionStoreMode()
  };
}

export async function GET() {
  const connections = await listAutoTradeConnections();
  return NextResponse.json({
    connections: connections.map(publicConnection),
    storageMode: autoTradeConnectionStoreMode()
  });
}

export async function POST(request: NextRequest) {
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as SavePayload;
  const providerId = parseAutoTradeProviderId(payload.providerId);
  if (!providerId) {
    return NextResponse.json({ error: "Choose a supported auto-trade provider." }, { status: 400 });
  }

  const fields = cleanFields(payload.fields);
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Enter the provider credentials before connecting." }, { status: 400 });
  }

  try {
    const connection = await saveAutoTradeConnection({
      accountId: text(payload.accountId),
      accountName: text(payload.accountName),
      fields,
      providerId
    });
    return NextResponse.json({
      connection: publicConnection(connection),
      connections: (await listAutoTradeConnections()).map(publicConnection),
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

  const connection = await setAutoTradeConnectionPaused(providerId, payload.paused !== false);
  if (!connection) {
    return NextResponse.json({ error: "Auto-trade provider is not connected." }, { status: 404 });
  }
  return NextResponse.json({
    connection: publicConnection(connection),
    connections: (await listAutoTradeConnections()).map(publicConnection),
    storageMode: autoTradeConnectionStoreMode()
  });
}

export async function DELETE(request: NextRequest) {
  const providerId = parseAutoTradeProviderId(request.nextUrl.searchParams.get("providerId"));
  if (!providerId) {
    return NextResponse.json({ error: "Choose a supported auto-trade provider." }, { status: 400 });
  }
  await deleteAutoTradeConnection(providerId);
  return NextResponse.json({
    connections: (await listAutoTradeConnections()).map(publicConnection),
    storageMode: autoTradeConnectionStoreMode()
  });
}
