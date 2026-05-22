import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { hashAccessCode, verifyAccessCode } from "@/lib/account-access-code";
import { firebaseDb, firebaseLocalFallbackEnabled, hasFirebaseAdmin, withFirebaseTimeout } from "@/lib/firebase-admin";
import { omitUndefinedDeep } from "@/lib/firestore-utils";
import type { ProjectXAccount, ProjectXConnectionSummary } from "@/lib/projectx";

const PROJECTX_CONNECTION_COLLECTION = "topstepProjectXConnections";
const PROJECTX_CONNECTION_LOCAL_PATH = path.join(process.cwd(), ".local", "topstep-projectx-connections.json");
const TOKEN_CIPHER_VERSION = "v1";
const TOKEN_CIPHER_ALGORITHM = "aes-256-gcm";

export type ProjectXConnectionStoreMode = "firebase" | "local";

type StoredProjectXConnectionPayload = {
  accessCodeHash?: string;
  accounts: ProjectXAccount[];
  accountCount: number;
  autoTradePaused?: boolean;
  connectedAt: string;
  displayName?: string;
  encryptedToken: string;
  id: string;
  lastCheckedAt?: string;
  pausedAccountIds?: number[];
  removedAccountIds?: number[];
  status: "connected" | "expired";
  tradeableAccountCount: number;
  updatedAt: string;
  userName?: string;
};

export type StoredProjectXConnection = Omit<StoredProjectXConnectionPayload, "encryptedToken"> & {
  token: string;
};

function encryptionSecret(): string {
  const secret = process.env.PROJECTX_CONNECTION_SECRET ?? process.env.APP_ADMIN_SECRET ?? process.env.CRON_SECRET;
  if (!secret || secret.trim().length < 12) {
    throw new Error("Set PROJECTX_CONNECTION_SECRET to persist TopstepX sessions.");
  }
  return secret;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(encryptionSecret()).digest();
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(TOKEN_CIPHER_ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [TOKEN_CIPHER_VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptToken(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== TOKEN_CIPHER_VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Stored ProjectX session token is unreadable.");
  }

  const decipher = createDecipheriv(TOKEN_CIPHER_ALGORITHM, encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

function normalizeAccounts(accounts: ProjectXAccount[]): ProjectXAccount[] {
  return accounts.map((account) => {
    const normalized: ProjectXAccount = {
      id: Number(account.id),
      name: String(account.name),
      canTrade: Boolean(account.canTrade),
      isVisible: Boolean(account.isVisible)
    };

    if (typeof account.balance === "number" && Number.isFinite(account.balance)) {
      normalized.balance = account.balance;
    }

    return normalized;
  });
}

function normalizePausedAccountIds(value: unknown, accounts: ProjectXAccount[], defaultPaused: boolean): number[] {
  if (!Array.isArray(value)) return defaultPaused ? accounts.map((account) => account.id) : [];
  const accountIds = new Set(accounts.map((account) => account.id));
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && accountIds.has(item));
}

function normalizeAccountIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item)))];
}

function removeAccounts(accounts: ProjectXAccount[], removedAccountIds: number[]): ProjectXAccount[] {
  const removedIds = new Set(removedAccountIds);
  return accounts.filter((account) => !removedIds.has(account.id));
}

function toStoredConnection(value: StoredProjectXConnectionPayload | null | undefined): StoredProjectXConnection | null {
  if (!value?.id || !value.encryptedToken) return null;
  const accounts = normalizeAccounts(value.accounts ?? []);
  const removedAccountIds = normalizeAccountIds(value.removedAccountIds);
  const autoTradePaused = value.autoTradePaused !== false;
  const pausedAccountIds = normalizePausedAccountIds(value.pausedAccountIds, accounts, autoTradePaused);
  return {
    accessCodeHash: typeof value.accessCodeHash === "string" ? value.accessCodeHash : undefined,
    accounts,
    accountCount: typeof value.accountCount === "number" ? value.accountCount : accounts.length,
    autoTradePaused: accounts.length > 0 && pausedAccountIds.length === accounts.length,
    connectedAt: typeof value.connectedAt === "string" ? value.connectedAt : new Date(0).toISOString(),
    displayName: typeof value.displayName === "string" ? value.displayName : undefined,
    id: value.id,
    lastCheckedAt: typeof value.lastCheckedAt === "string" ? value.lastCheckedAt : undefined,
    pausedAccountIds,
    removedAccountIds,
    status: value.status === "expired" ? "expired" : "connected",
    token: decryptToken(value.encryptedToken),
    tradeableAccountCount:
      typeof value.tradeableAccountCount === "number" ? value.tradeableAccountCount : accounts.filter((account) => account.canTrade).length,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    userName: typeof value.userName === "string" ? value.userName : undefined
  };
}

function safeToStoredConnection(value: StoredProjectXConnectionPayload | null | undefined): StoredProjectXConnection | null {
  try {
    return toStoredConnection(value);
  } catch {
    return null;
  }
}

function toConnectionSummary(value: StoredProjectXConnectionPayload | null | undefined): ProjectXConnectionSummary | null {
  if (!value?.id) return null;
  const accounts = normalizeAccounts(value.accounts ?? []);
  const removedAccountIds = normalizeAccountIds(value.removedAccountIds);
  const autoTradePaused = value.autoTradePaused !== false;
  const pausedAccountIds = normalizePausedAccountIds(value.pausedAccountIds, accounts, autoTradePaused);
  return {
    accounts,
    autoTradePaused: accounts.length > 0 && pausedAccountIds.length === accounts.length,
    connectedAt: typeof value.connectedAt === "string" ? value.connectedAt : new Date(0).toISOString(),
    displayName: typeof value.displayName === "string" ? value.displayName : undefined,
    id: value.id,
    pausedAccountIds,
    readable: Boolean(safeToStoredConnection(value)),
    removedAccountIds,
    status: value.status === "expired" ? "expired" : "connected",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    userName: typeof value.userName === "string" ? value.userName : undefined
  };
}

function newestConnectionFirst(left: StoredProjectXConnection, right: StoredProjectXConnection): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function newestSummaryFirst(left: ProjectXConnectionSummary, right: ProjectXConnectionSummary): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

async function readLocalConnections(): Promise<Record<string, StoredProjectXConnectionPayload>> {
  try {
    return JSON.parse(await readFile(PROJECTX_CONNECTION_LOCAL_PATH, "utf8")) as Record<string, StoredProjectXConnectionPayload>;
  } catch {
    return {};
  }
}

async function writeLocalConnections(connections: Record<string, StoredProjectXConnectionPayload>): Promise<void> {
  await mkdir(path.dirname(PROJECTX_CONNECTION_LOCAL_PATH), { recursive: true });
  await writeFile(PROJECTX_CONNECTION_LOCAL_PATH, JSON.stringify(connections, null, 2));
}

export function projectXConnectionStoreMode(): ProjectXConnectionStoreMode {
  return hasFirebaseAdmin() ? "firebase" : "local";
}

export async function getStoredProjectXConnection(id: string): Promise<StoredProjectXConnection | null> {
  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(firebaseDb().collection(PROJECTX_CONNECTION_COLLECTION).doc(id).get(), "Firebase ProjectX connection read");
      return toStoredConnection(snapshot.data() as StoredProjectXConnectionPayload | undefined);
    } catch {
      const connections = await readLocalConnections();
      return toStoredConnection(connections[id]);
    }
  }

  const connections = await readLocalConnections();
  return toStoredConnection(connections[id]);
}

export async function getStoredProjectXConnections(): Promise<StoredProjectXConnection[]> {
  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(firebaseDb().collection(PROJECTX_CONNECTION_COLLECTION).get(), "Firebase ProjectX connections list");
      return snapshot.docs
        .map((doc) => safeToStoredConnection(doc.data() as StoredProjectXConnectionPayload | undefined))
        .filter((connection): connection is StoredProjectXConnection => connection !== null && connection.status === "connected")
        .sort(newestConnectionFirst);
    } catch {
      const connections = await readLocalConnections();
      return Object.values(connections)
        .map((connection) => safeToStoredConnection(connection))
        .filter((connection): connection is StoredProjectXConnection => connection !== null && connection.status === "connected")
        .sort(newestConnectionFirst);
    }
  }

  const connections = await readLocalConnections();
  return Object.values(connections)
    .map((connection) => safeToStoredConnection(connection))
    .filter((connection): connection is StoredProjectXConnection => connection !== null && connection.status === "connected")
    .sort(newestConnectionFirst);
}

export async function getStoredProjectXConnectionSummaries(): Promise<ProjectXConnectionSummary[]> {
  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(firebaseDb().collection(PROJECTX_CONNECTION_COLLECTION).get(), "Firebase ProjectX summaries list");
      return snapshot.docs
        .map((doc) => toConnectionSummary(doc.data() as StoredProjectXConnectionPayload | undefined))
        .filter((connection): connection is ProjectXConnectionSummary => connection !== null && connection.status === "connected")
        .sort(newestSummaryFirst);
    } catch {
      const connections = await readLocalConnections();
      return Object.values(connections)
        .map((connection) => toConnectionSummary(connection))
        .filter((connection): connection is ProjectXConnectionSummary => connection !== null && connection.status === "connected")
        .sort(newestSummaryFirst);
    }
  }

  const connections = await readLocalConnections();
  return Object.values(connections)
    .map((connection) => toConnectionSummary(connection))
    .filter((connection): connection is ProjectXConnectionSummary => connection !== null && connection.status === "connected")
    .sort(newestSummaryFirst);
}

export async function getLatestStoredProjectXConnection(preferredId?: string): Promise<StoredProjectXConnection | null> {
  const preferredConnection = preferredId
    ? await getStoredProjectXConnection(preferredId).catch(() => null)
    : null;
  if (preferredConnection?.status === "connected") return preferredConnection;
  return (await getStoredProjectXConnections())[0] ?? null;
}

export async function saveStoredProjectXConnection(input: {
  accessCode?: string;
  accessCodeHash?: string;
  accounts: ProjectXAccount[];
  autoTradePaused?: boolean;
  connectedAt?: string;
  displayName?: string;
  id: string;
  pausedAccountIds?: number[];
  removedAccountIds?: number[];
  token: string;
  userName?: string;
}): Promise<StoredProjectXConnection> {
  const now = new Date().toISOString();
  const removedAccountIds = normalizeAccountIds(input.removedAccountIds);
  const accounts = removeAccounts(normalizeAccounts(input.accounts), removedAccountIds);
  const pausedAccountIds = normalizePausedAccountIds(input.pausedAccountIds, accounts, input.autoTradePaused !== false);
  const payload: StoredProjectXConnectionPayload = {
    accessCodeHash: input.accessCode ? hashAccessCode(input.accessCode) : input.accessCodeHash,
    accounts,
    accountCount: accounts.length,
    autoTradePaused: accounts.length > 0 && pausedAccountIds.length === accounts.length,
    connectedAt: input.connectedAt ?? now,
    displayName: input.displayName?.trim() || undefined,
    encryptedToken: encryptToken(input.token),
    id: input.id,
    lastCheckedAt: now,
    pausedAccountIds,
    removedAccountIds,
    status: "connected",
    tradeableAccountCount: accounts.filter((account) => account.canTrade).length,
    updatedAt: now
  };

  if (input.userName) payload.userName = input.userName;

  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb()
          .collection(PROJECTX_CONNECTION_COLLECTION)
          .doc(input.id)
          .set(
            omitUndefinedDeep({
              ...payload,
              updatedAtServer: FieldValue.serverTimestamp()
            }),
            { merge: true }
          ),
        "Firebase ProjectX connection save"
      );
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
      const connections = await readLocalConnections();
      connections[input.id] = payload;
      await writeLocalConnections(connections);
    }
  } else {
    const connections = await readLocalConnections();
    connections[input.id] = payload;
    await writeLocalConnections(connections);
  }

  return toStoredConnection(payload)!;
}

export async function setStoredProjectXConnectionPaused(id: string, autoTradePaused: boolean, accountId?: number): Promise<StoredProjectXConnection | null> {
  const connection = await getStoredProjectXConnection(id);
  if (!connection) return null;
  const accountIds = connection.accounts.map((account) => account.id);
  const pausedAccountIds = new Set(connection.pausedAccountIds);

  if (typeof accountId === "number" && accountIds.includes(accountId)) {
    if (autoTradePaused) {
      pausedAccountIds.add(accountId);
    } else {
      pausedAccountIds.delete(accountId);
    }
  } else {
    pausedAccountIds.clear();
    if (autoTradePaused) {
      for (const id of accountIds) pausedAccountIds.add(id);
    }
  }

  return saveStoredProjectXConnection({
    accounts: connection.accounts,
    accessCodeHash: connection.accessCodeHash,
    connectedAt: connection.connectedAt,
    displayName: connection.displayName,
    id,
    pausedAccountIds: [...pausedAccountIds],
    removedAccountIds: connection.removedAccountIds,
    token: connection.token,
    userName: connection.userName
  });
}

export async function removeStoredProjectXConnectionAccount(id: string, accountId: number): Promise<StoredProjectXConnection | null> {
  const connection = await getStoredProjectXConnection(id);
  if (!connection) return null;
  if (!connection.accounts.some((account) => account.id === accountId)) return connection;

  const removedAccountIds = [...new Set([...(connection.removedAccountIds ?? []), accountId])];
  return saveStoredProjectXConnection({
    accounts: connection.accounts,
    accessCodeHash: connection.accessCodeHash,
    connectedAt: connection.connectedAt,
    displayName: connection.displayName,
    id,
    pausedAccountIds: connection.pausedAccountIds?.filter((id) => id !== accountId),
    removedAccountIds,
    token: connection.token,
    userName: connection.userName
  });
}

export async function setStoredProjectXConnectionAccessCode(id: string, accessCode: string): Promise<boolean> {
  const accessCodeHash = hashAccessCode(accessCode);
  const updatedAt = new Date().toISOString();

  if (hasFirebaseAdmin()) {
    try {
      const ref = firebaseDb().collection(PROJECTX_CONNECTION_COLLECTION).doc(id);
      const snapshot = await withFirebaseTimeout(ref.get(), "Firebase ProjectX connection read");
      const payload = snapshot.data() as StoredProjectXConnectionPayload | undefined;
      if (!payload || payload.status !== "connected") return false;

      await withFirebaseTimeout(
        ref.set(
          omitUndefinedDeep({
            accessCodeHash,
            updatedAt,
            updatedAtServer: FieldValue.serverTimestamp()
          }),
          { merge: true }
        ),
        "Firebase ProjectX access-code update"
      );
      return true;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }

  const connections = await readLocalConnections();
  const connection = connections[id];
  if (!connection || connection.status !== "connected") return false;
  connections[id] = {
    ...connection,
    accessCodeHash,
    updatedAt
  };
  await writeLocalConnections(connections);
  return true;
}

export async function verifyStoredProjectXConnectionAccessCode(id: string, accessCode: string): Promise<boolean> {
  const payload = hasFirebaseAdmin()
    ? await withFirebaseTimeout(firebaseDb().collection(PROJECTX_CONNECTION_COLLECTION).doc(id).get(), "Firebase ProjectX access-code read")
        .then((snapshot) => snapshot.data() as StoredProjectXConnectionPayload | undefined)
        .catch(async () => (await readLocalConnections())[id])
    : (await readLocalConnections())[id];
  if (!payload || payload.status !== "connected") return false;
  return verifyAccessCode(accessCode, typeof payload.accessCodeHash === "string" ? payload.accessCodeHash : undefined);
}

export async function deleteStoredProjectXConnection(id: string): Promise<void> {
  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(firebaseDb().collection(PROJECTX_CONNECTION_COLLECTION).doc(id).delete(), "Firebase ProjectX connection delete");
      return;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }

  const connections = await readLocalConnections();
  delete connections[id];
  await writeLocalConnections(connections);
}
