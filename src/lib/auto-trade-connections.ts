import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { hashAccessCode, verifyAccessCode } from "@/lib/account-access-code";
import { autoTradeProviderById, type AutoTradeProviderId } from "@/lib/auto-trade-platforms";
import { firebaseDb, firebaseLocalFallbackEnabled, hasFirebaseAdmin, withFirebaseTimeout } from "@/lib/firebase-admin";
import { omitUndefinedDeep } from "@/lib/firestore-utils";
import { deleteTursoDocument, getTursoDocument, listTursoDocuments, saveTursoDocument, tursoConfigured } from "@/lib/turso";

const COLLECTION = "autoTradeConnections";
const LOCAL_PATH = path.join(process.cwd(), ".local", "auto-trade-connections.json");
const TOKEN_CIPHER_VERSION = "v1";
const TOKEN_CIPHER_ALGORITHM = "aes-256-gcm";

export type AutoTradeConnection = {
  accessCodeHash?: string;
  accountId?: string;
  accountName?: string;
  connectedAt: string;
  fields: Record<string, string>;
  firmId?: string;
  firmLabel?: string;
  id: string;
  lastCheckedAt?: string;
  paused: boolean;
  providerId: AutoTradeProviderId;
  providerLabel: string;
  status: "connected";
  updatedAt: string;
};

type StoredAutoTradeConnection = Omit<AutoTradeConnection, "fields"> & {
  encryptedFields: string;
};

type AutoTradeConnectionStoreMode = "firebase" | "local" | "turso";

function encryptionSecret(): string {
  const secret = process.env.AUTO_TRADE_CONNECTION_SECRET ?? process.env.PROJECTX_CONNECTION_SECRET ?? process.env.APP_ADMIN_SECRET ?? process.env.CRON_SECRET;
  if (!secret || secret.trim().length < 12) {
    throw new Error("Set AUTO_TRADE_CONNECTION_SECRET or PROJECTX_CONNECTION_SECRET to persist auto-trade credentials.");
  }
  return secret;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(encryptionSecret()).digest();
}

function encryptFields(fields: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(TOKEN_CIPHER_ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(fields), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [TOKEN_CIPHER_VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptFields(value: string): Record<string, string> {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== TOKEN_CIPHER_VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Stored auto-trade credentials are unreadable.");
  }
  const decipher = createDecipheriv(TOKEN_CIPHER_ALGORITHM, encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const raw = Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => [key, typeof value === "string" ? value : String(value)])
      .filter(([key, value]) => Boolean(key && value))
  );
}

function normalizeProviderId(value: string): AutoTradeProviderId | null {
  const providerId = value.trim() as AutoTradeProviderId;
  return autoTradeProviderById(providerId) ? providerId : null;
}

function toConnection(value: StoredAutoTradeConnection | null | undefined): AutoTradeConnection | null {
  if (!value?.id || !value.encryptedFields) return null;
  const providerId = normalizeProviderId(String(value.providerId ?? value.id));
  if (!providerId) return null;
  const provider = autoTradeProviderById(providerId);
  if (!provider) return null;
  return {
    accessCodeHash: typeof value.accessCodeHash === "string" ? value.accessCodeHash : undefined,
    accountId: value.accountId,
    accountName: value.accountName,
    connectedAt: typeof value.connectedAt === "string" ? value.connectedAt : new Date(0).toISOString(),
    fields: decryptFields(value.encryptedFields),
    firmId: typeof value.firmId === "string" ? value.firmId : undefined,
    firmLabel: typeof value.firmLabel === "string" ? value.firmLabel : undefined,
    id: String(value.id),
    lastCheckedAt: value.lastCheckedAt,
    paused: value.paused === true,
    providerId,
    providerLabel: provider.label,
    status: "connected",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString()
  };
}

function safeToConnection(value: StoredAutoTradeConnection | null | undefined): AutoTradeConnection | null {
  try {
    return toConnection(value);
  } catch {
    return null;
  }
}

async function readLocal(): Promise<Record<string, StoredAutoTradeConnection>> {
  try {
    return JSON.parse(await readFile(LOCAL_PATH, "utf8")) as Record<string, StoredAutoTradeConnection>;
  } catch {
    return {};
  }
}

async function writeLocal(connections: Record<string, StoredAutoTradeConnection>): Promise<void> {
  await mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  await writeFile(LOCAL_PATH, JSON.stringify(connections, null, 2));
}

async function readTursoConnection(connectionId: string): Promise<AutoTradeConnection | null> {
  const doc = await getTursoDocument(COLLECTION, connectionId);
  return toConnection(doc ? ({ ...doc.payload, id: doc.payload.id ?? doc.id } as StoredAutoTradeConnection) : undefined);
}

async function listTursoConnections(): Promise<AutoTradeConnection[]> {
  return (await listTursoDocuments(COLLECTION, 100))
    .map((doc) => safeToConnection({ ...doc.payload, id: doc.payload.id ?? doc.id } as StoredAutoTradeConnection))
    .filter((connection): connection is AutoTradeConnection => Boolean(connection));
}

async function saveTursoConnection(payload: StoredAutoTradeConnection): Promise<void> {
  await saveTursoDocument({
    collection: COLLECTION,
    id: payload.id,
    payload,
    sortTimeMillis: Date.parse(payload.updatedAt)
  });
}

export function autoTradeConnectionStoreMode(): AutoTradeConnectionStoreMode {
  if (tursoConfigured()) return "turso";
  return hasFirebaseAdmin() ? "firebase" : "local";
}

export function autoTradeConnectionRecordId(providerId: AutoTradeProviderId, accountId?: string): string {
  const normalizedAccountId = accountId?.trim().replace(/[^0-9A-Za-z_-]/g, "");
  return providerId === "mt5_ea" && normalizedAccountId ? `mt5_ea_${normalizedAccountId}` : providerId;
}

function mt5ConnectionIdentity(connection: AutoTradeConnection): string {
  return (connection.fields.bridgeAccountId ?? connection.fields.login ?? connection.accountId ?? connection.id).trim();
}

function dedupeAutoTradeConnections(connections: AutoTradeConnection[]): AutoTradeConnection[] {
  const seenMt5Accounts = new Set<string>();
  return [...connections]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .filter((connection) => {
      if (connection.providerId !== "mt5_ea") return true;
      const identity = mt5ConnectionIdentity(connection);
      if (seenMt5Accounts.has(identity)) return false;
      seenMt5Accounts.add(identity);
      return true;
    });
}

export async function getAutoTradeConnectionById(connectionId: string): Promise<AutoTradeConnection | null> {
  if (tursoConfigured()) {
    try {
      const connection = await readTursoConnection(connectionId);
      if (connection) return connection;
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(firebaseDb().collection(COLLECTION).doc(connectionId).get(), "Firebase auto-trade connection read");
      const payload = snapshot.data() as StoredAutoTradeConnection | undefined;
      return toConnection(payload ? { ...payload, id: payload.id ?? connectionId } : undefined);
    } catch {
      return toConnection((await readLocal())[connectionId]);
    }
  }
  return toConnection((await readLocal())[connectionId]);
}

export async function listAutoTradeConnections(): Promise<AutoTradeConnection[]> {
  if (tursoConfigured()) {
    try {
      const connections = await listTursoConnections();
      if (connections.length) return dedupeAutoTradeConnections(connections);
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(firebaseDb().collection(COLLECTION).get(), "Firebase auto-trade connections list");
      return dedupeAutoTradeConnections(snapshot.docs
        .map((doc) => {
          const payload = doc.data() as StoredAutoTradeConnection | undefined;
          return safeToConnection(payload ? { ...payload, id: payload.id ?? doc.id } : undefined);
        })
        .filter((connection): connection is AutoTradeConnection => Boolean(connection)));
    } catch {
      return dedupeAutoTradeConnections(Object.values(await readLocal())
        .map((connection) => safeToConnection(connection))
        .filter((connection): connection is AutoTradeConnection => Boolean(connection)));
    }
  }
  return dedupeAutoTradeConnections(Object.values(await readLocal())
    .map((connection) => safeToConnection(connection))
    .filter((connection): connection is AutoTradeConnection => Boolean(connection)));
}

export async function listAutoTradeConnectionsForProvider(providerId: AutoTradeProviderId): Promise<AutoTradeConnection[]> {
  return (await listAutoTradeConnections())
    .filter((connection) => connection.providerId === providerId);
}

export async function getAutoTradeConnection(providerId: AutoTradeProviderId, connectionId?: string): Promise<AutoTradeConnection | null> {
  if (connectionId) {
    const connection = await getAutoTradeConnectionById(connectionId);
    return connection?.providerId === providerId ? connection : null;
  }

  const legacyConnection = await getAutoTradeConnectionById(providerId);
  if (legacyConnection?.providerId === providerId) return legacyConnection;
  return (await listAutoTradeConnectionsForProvider(providerId))[0] ?? null;
}

export async function saveAutoTradeConnection(input: {
  accessCode?: string;
  accessCodeHash?: string;
  accountId?: string;
  accountName?: string;
  fields: Record<string, string>;
  firmId?: string;
  firmLabel?: string;
  connectionId?: string;
  providerId: AutoTradeProviderId;
}): Promise<AutoTradeConnection> {
  const provider = autoTradeProviderById(input.providerId);
  if (!provider) throw new Error("Unknown auto-trade provider.");
  let connectionId = input.connectionId?.trim() || autoTradeConnectionRecordId(input.providerId, input.accountId);
  let existing = await getAutoTradeConnection(input.providerId, connectionId);
  if (!input.connectionId && input.providerId === "mt5_ea" && !existing) {
    const legacy = await getAutoTradeConnectionById("mt5_ea");
    const incomingIdentity = (input.fields.bridgeAccountId ?? input.fields.login ?? input.accountId ?? "").trim();
    if (legacy?.providerId === "mt5_ea" && mt5ConnectionIdentity(legacy) === incomingIdentity) {
      connectionId = legacy.id;
      existing = legacy;
    }
  }
  const now = new Date().toISOString();
  const cleanFields = Object.fromEntries(Object.entries(input.fields).filter(([, value]) => Boolean(value?.trim())));
  const payload: StoredAutoTradeConnection = {
    accessCodeHash: input.accessCode ? hashAccessCode(input.accessCode) : input.accessCodeHash ?? existing?.accessCodeHash,
    accountId: input.accountId,
    accountName: input.accountName,
    connectedAt: existing?.connectedAt ?? now,
    encryptedFields: encryptFields(cleanFields),
    firmId: input.firmId,
    firmLabel: input.firmLabel,
    id: connectionId,
    lastCheckedAt: now,
    paused: existing?.paused ?? true,
    providerId: input.providerId,
    providerLabel: provider.label,
    status: "connected",
    updatedAt: now
  };

  let persistedToPrimary = false;
  if (tursoConfigured()) {
    try {
      await saveTursoConnection(payload);
      persistedToPrimary = true;
    } catch (error) {
      if (!hasFirebaseAdmin() && !firebaseLocalFallbackEnabled()) throw error;
    }
  }

  if (!persistedToPrimary && hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb()
          .collection(COLLECTION)
          .doc(connectionId)
          .set(omitUndefinedDeep({ ...payload, updatedAtServer: FieldValue.serverTimestamp() }), { merge: true }),
        "Firebase auto-trade connection save"
      );
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
      const connections = await readLocal();
      connections[connectionId] = payload;
      await writeLocal(connections);
    }
  } else if (!persistedToPrimary) {
    const connections = await readLocal();
    connections[connectionId] = payload;
    await writeLocal(connections);
  }

  return toConnection(payload)!;
}

export async function setAutoTradeConnectionPaused(connectionId: string, paused: boolean): Promise<AutoTradeConnection | null> {
  const connection = await getAutoTradeConnectionById(connectionId);
  if (!connection) return null;
  return saveAutoTradeConnection({
    accessCodeHash: connection.accessCodeHash,
    accountId: connection.accountId,
    accountName: connection.accountName,
    fields: connection.fields,
    firmId: connection.firmId,
    firmLabel: connection.firmLabel,
    connectionId: connection.id,
    providerId: connection.providerId
  }).then((saved) => {
    saved.paused = paused;
    return persistPaused(saved);
  });
}

async function persistPaused(connection: AutoTradeConnection): Promise<AutoTradeConnection> {
  const payload: StoredAutoTradeConnection = {
    accessCodeHash: connection.accessCodeHash,
    accountId: connection.accountId,
    accountName: connection.accountName,
    connectedAt: connection.connectedAt,
    encryptedFields: encryptFields(connection.fields),
    firmId: connection.firmId,
    firmLabel: connection.firmLabel,
    id: connection.id,
    lastCheckedAt: new Date().toISOString(),
    paused: connection.paused,
    providerId: connection.providerId,
    providerLabel: connection.providerLabel,
    status: "connected",
    updatedAt: new Date().toISOString()
  };
  let persistedToPrimary = false;
  if (tursoConfigured()) {
    try {
      await saveTursoConnection(payload);
      persistedToPrimary = true;
    } catch (error) {
      if (!hasFirebaseAdmin() && !firebaseLocalFallbackEnabled()) throw error;
    }
  }

  if (!persistedToPrimary && hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb()
          .collection(COLLECTION)
          .doc(connection.id)
          .set(omitUndefinedDeep({ ...payload, updatedAtServer: FieldValue.serverTimestamp() }), { merge: true }),
        "Firebase auto-trade pause save"
      );
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
      const connections = await readLocal();
      connections[connection.id] = payload;
      await writeLocal(connections);
    }
  } else if (!persistedToPrimary) {
    const connections = await readLocal();
    connections[connection.id] = payload;
    await writeLocal(connections);
  }
  return toConnection(payload)!;
}

export async function deleteAutoTradeConnection(connectionId: string): Promise<void> {
  if (tursoConfigured()) {
    try {
      await deleteTursoDocument(COLLECTION, connectionId);
      return;
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(firebaseDb().collection(COLLECTION).doc(connectionId).delete(), "Firebase auto-trade connection delete");
      return;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }
  const connections = await readLocal();
  delete connections[connectionId];
  await writeLocal(connections);
}

export async function verifyAutoTradeConnectionAccessCode(connectionId: string, accessCode: string): Promise<boolean> {
  const payload = tursoConfigured()
    ? await getTursoDocument(COLLECTION, connectionId)
        .then((doc) => doc?.payload as StoredAutoTradeConnection | undefined)
        .catch(async () =>
          hasFirebaseAdmin()
            ? await withFirebaseTimeout(firebaseDb().collection(COLLECTION).doc(connectionId).get(), "Firebase auto-trade access-code read")
                .then((snapshot) => snapshot.data() as StoredAutoTradeConnection | undefined)
                .catch(async () => (await readLocal())[connectionId])
            : (await readLocal())[connectionId]
        )
    : hasFirebaseAdmin()
    ? await withFirebaseTimeout(firebaseDb().collection(COLLECTION).doc(connectionId).get(), "Firebase auto-trade access-code read")
        .then((snapshot) => snapshot.data() as StoredAutoTradeConnection | undefined)
        .catch(async () => (await readLocal())[connectionId])
    : (await readLocal())[connectionId];
  if (!payload || payload.status !== "connected") return false;
  return verifyAccessCode(accessCode, typeof payload.accessCodeHash === "string" ? payload.accessCodeHash : undefined);
}

export function parseAutoTradeProviderId(value: unknown): AutoTradeProviderId | null {
  return typeof value === "string" ? normalizeProviderId(value) : null;
}
