import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { hashAccessCode, verifyAccessCode } from "@/lib/account-access-code";
import { autoTradeProviderById, type AutoTradeProviderId } from "@/lib/auto-trade-platforms";
import { firebaseDb, firebaseLocalFallbackEnabled, hasFirebaseAdmin, withFirebaseTimeout } from "@/lib/firebase-admin";
import { omitUndefinedDeep } from "@/lib/firestore-utils";

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
  id: AutoTradeProviderId;
  lastCheckedAt?: string;
  paused: boolean;
  providerLabel: string;
  status: "connected";
  updatedAt: string;
};

type StoredAutoTradeConnection = Omit<AutoTradeConnection, "fields"> & {
  encryptedFields: string;
};

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
  const provider = autoTradeProviderById(value.id);
  if (!provider) return null;
  return {
    accessCodeHash: typeof value.accessCodeHash === "string" ? value.accessCodeHash : undefined,
    accountId: value.accountId,
    accountName: value.accountName,
    connectedAt: typeof value.connectedAt === "string" ? value.connectedAt : new Date(0).toISOString(),
    fields: decryptFields(value.encryptedFields),
    firmId: typeof value.firmId === "string" ? value.firmId : undefined,
    firmLabel: typeof value.firmLabel === "string" ? value.firmLabel : undefined,
    id: value.id,
    lastCheckedAt: value.lastCheckedAt,
    paused: value.paused === true,
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

export function autoTradeConnectionStoreMode(): "firebase" | "local" {
  return hasFirebaseAdmin() ? "firebase" : "local";
}

export async function getAutoTradeConnection(providerId: AutoTradeProviderId): Promise<AutoTradeConnection | null> {
  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(firebaseDb().collection(COLLECTION).doc(providerId).get(), "Firebase auto-trade connection read");
      return toConnection(snapshot.data() as StoredAutoTradeConnection | undefined);
    } catch {
      return toConnection((await readLocal())[providerId]);
    }
  }
  return toConnection((await readLocal())[providerId]);
}

export async function listAutoTradeConnections(): Promise<AutoTradeConnection[]> {
  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(firebaseDb().collection(COLLECTION).get(), "Firebase auto-trade connections list");
      return snapshot.docs
        .map((doc) => safeToConnection(doc.data() as StoredAutoTradeConnection | undefined))
        .filter((connection): connection is AutoTradeConnection => Boolean(connection));
    } catch {
      return Object.values(await readLocal())
        .map((connection) => safeToConnection(connection))
        .filter((connection): connection is AutoTradeConnection => Boolean(connection));
    }
  }
  return Object.values(await readLocal())
    .map((connection) => safeToConnection(connection))
    .filter((connection): connection is AutoTradeConnection => Boolean(connection));
}

export async function saveAutoTradeConnection(input: {
  accessCode?: string;
  accessCodeHash?: string;
  accountId?: string;
  accountName?: string;
  fields: Record<string, string>;
  firmId?: string;
  firmLabel?: string;
  providerId: AutoTradeProviderId;
}): Promise<AutoTradeConnection> {
  const provider = autoTradeProviderById(input.providerId);
  if (!provider) throw new Error("Unknown auto-trade provider.");
  const existing = await getAutoTradeConnection(input.providerId);
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
    id: input.providerId,
    lastCheckedAt: now,
    paused: existing?.paused ?? true,
    providerLabel: provider.label,
    status: "connected",
    updatedAt: now
  };

  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb()
          .collection(COLLECTION)
          .doc(input.providerId)
          .set(omitUndefinedDeep({ ...payload, updatedAtServer: FieldValue.serverTimestamp() }), { merge: true }),
        "Firebase auto-trade connection save"
      );
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
      const connections = await readLocal();
      connections[input.providerId] = payload;
      await writeLocal(connections);
    }
  } else {
    const connections = await readLocal();
    connections[input.providerId] = payload;
    await writeLocal(connections);
  }

  return toConnection(payload)!;
}

export async function setAutoTradeConnectionPaused(providerId: AutoTradeProviderId, paused: boolean): Promise<AutoTradeConnection | null> {
  const connection = await getAutoTradeConnection(providerId);
  if (!connection) return null;
  return saveAutoTradeConnection({
    accessCodeHash: connection.accessCodeHash,
    accountId: connection.accountId,
    accountName: connection.accountName,
    fields: connection.fields,
    firmId: connection.firmId,
    firmLabel: connection.firmLabel,
    providerId
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
    providerLabel: connection.providerLabel,
    status: "connected",
    updatedAt: new Date().toISOString()
  };
  if (hasFirebaseAdmin()) {
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
  } else {
    const connections = await readLocal();
    connections[connection.id] = payload;
    await writeLocal(connections);
  }
  return toConnection(payload)!;
}

export async function deleteAutoTradeConnection(providerId: AutoTradeProviderId): Promise<void> {
  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(firebaseDb().collection(COLLECTION).doc(providerId).delete(), "Firebase auto-trade connection delete");
      return;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }
  const connections = await readLocal();
  delete connections[providerId];
  await writeLocal(connections);
}

export async function verifyAutoTradeConnectionAccessCode(providerId: AutoTradeProviderId, accessCode: string): Promise<boolean> {
  const payload = hasFirebaseAdmin()
    ? await withFirebaseTimeout(firebaseDb().collection(COLLECTION).doc(providerId).get(), "Firebase auto-trade access-code read")
        .then((snapshot) => snapshot.data() as StoredAutoTradeConnection | undefined)
        .catch(async () => (await readLocal())[providerId])
    : (await readLocal())[providerId];
  if (!payload || payload.status !== "connected") return false;
  return verifyAccessCode(accessCode, typeof payload.accessCodeHash === "string" ? payload.accessCodeHash : undefined);
}

export function parseAutoTradeProviderId(value: unknown): AutoTradeProviderId | null {
  return typeof value === "string" ? normalizeProviderId(value) : null;
}
