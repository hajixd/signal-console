import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { hashAccessCode, isValidAccessCode } from "@/lib/account-access-code";
import { isAdminAuthorized } from "@/lib/admin-api";
import { createTursoDocument, listTursoDocuments, saveTursoDocument } from "@/lib/turso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COLLECTION = "topstepProjectXConnections";
const BACKUP_COLLECTION = "topstepProjectXConnectionsBackups";

type UpdatePayload = {
  accessCode?: unknown;
  addName?: unknown;
  sourceName?: unknown;
  targetName?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = ((await request.json().catch(() => ({}))) ?? {}) as UpdatePayload;
  const accessCode = text(payload.accessCode);
  const sourceName = text(payload.sourceName);
  const targetName = text(payload.targetName);
  const addName = text(payload.addName);
  if (!isValidAccessCode(accessCode) || !sourceName || !targetName || !addName) {
    return NextResponse.json({ error: "Provide the source, target, added folder, and a five-digit code." }, { status: 400 });
  }

  const documents = await listTursoDocuments(COLLECTION, 100);
  const byName = (name: string) =>
    documents.find((document) => String(document.payload.displayName ?? "").trim().toLowerCase() === name.toLowerCase());
  const source = byName(sourceName);
  let target = byName(targetName);
  let added = byName(addName);
  const accessCodeHash = hashAccessCode(accessCode);
  const timestamp = new Date().toISOString();
  const sortTimeMillis = Date.parse(timestamp);

  if (source) {
    await createTursoDocument({
      collection: BACKUP_COLLECTION,
      id: `${timestamp.replace(/[^0-9]/g, "")}-${source.id}`,
      payload: {
        originalCollection: COLLECTION,
        originalId: source.id,
        originalPayload: source.payload,
        reason: `Rename ${sourceName} to ${targetName} and add ${addName} per owner request.`
      },
      sortTimeMillis
    });

    const renamedPayload = {
      ...source.payload,
      accessCodeHash,
      displayName: targetName,
      id: source.id,
      updatedAt: timestamp
    };
    await saveTursoDocument({ collection: COLLECTION, id: source.id, payload: renamedPayload, sortTimeMillis });
    target = { ...source, payload: renamedPayload, sortTimeMillis };
  }

  if (!target) {
    return NextResponse.json({ error: `${sourceName} was not found and ${targetName} does not already exist.` }, { status: 404 });
  }

  if (!source) {
    await saveTursoDocument({
      collection: COLLECTION,
      id: target.id,
      payload: { ...target.payload, accessCodeHash, displayName: targetName, id: target.id, updatedAt: timestamp },
      sortTimeMillis
    });
  }

  if (!added) {
    const id = randomUUID();
    const addedPayload = {
      accessCodeHash,
      accounts: [],
      accountCount: 0,
      autoTradePaused: true,
      connectedAt: timestamp,
      displayName: addName,
      encryptedToken: target.payload.encryptedToken,
      id,
      lastCheckedAt: timestamp,
      pausedAccountIds: [],
      removedAccountIds: [],
      status: "expired",
      tradeableAccountCount: 0,
      updatedAt: timestamp
    };
    await saveTursoDocument({ collection: COLLECTION, id, payload: addedPayload, sortTimeMillis: sortTimeMillis + 1 });
    added = { collection: COLLECTION, id, payload: addedPayload, sortTimeMillis: sortTimeMillis + 1 };
  } else {
    await saveTursoDocument({
      collection: COLLECTION,
      id: added.id,
      payload: { ...added.payload, accessCodeHash, displayName: addName, id: added.id, updatedAt: timestamp },
      sortTimeMillis
    });
  }

  return NextResponse.json({
    ok: true,
    renamed: Boolean(source),
    folders: [
      { id: target.id, name: targetName },
      { id: added.id, name: addName }
    ]
  });
}
