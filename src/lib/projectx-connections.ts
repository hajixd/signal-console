import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseDb, hasFirebaseAdmin } from "@/lib/firebase-admin";
import type { ProjectXAccount } from "@/lib/projectx";

const PROJECTX_CONNECTION_COLLECTION = "topstepProjectXConnections";
const PROJECTX_CONNECTION_LOCAL_PATH = path.join(process.cwd(), ".local", "topstep-projectx-connections.json");
const TOKEN_CIPHER_VERSION = "v1";
const TOKEN_CIPHER_ALGORITHM = "aes-256-gcm";

export type ProjectXConnectionStoreMode = "firebase" | "local";

type StoredProjectXConnectionPayload = {
  accounts: ProjectXAccount[];
  accountCount: number;
  connectedAt: string;
  encryptedToken: string;
  id: string;
  lastCheckedAt?: string;
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
  return accounts.map((account) => ({
    id: Number(account.id),
    name: String(account.name),
    balance: typeof account.balance === "number" && Number.isFinite(account.balance) ? account.balance : undefined,
    canTrade: Boolean(account.canTrade),
    isVisible: Boolean(account.isVisible)
  }));
}

function toStoredConnection(value: StoredProjectXConnectionPayload | null | undefined): StoredProjectXConnection | null {
  if (!value?.id || !value.encryptedToken) return null;
  const accounts = normalizeAccounts(value.accounts ?? []);
  return {
    accounts,
    accountCount: typeof value.accountCount === "number" ? value.accountCount : accounts.length,
    connectedAt: typeof value.connectedAt === "string" ? value.connectedAt : new Date(0).toISOString(),
    id: value.id,
    lastCheckedAt: typeof value.lastCheckedAt === "string" ? value.lastCheckedAt : undefined,
    status: value.status === "expired" ? "expired" : "connected",
    token: decryptToken(value.encryptedToken),
    tradeableAccountCount:
      typeof value.tradeableAccountCount === "number" ? value.tradeableAccountCount : accounts.filter((account) => account.canTrade).length,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    userName: typeof value.userName === "string" ? value.userName : undefined
  };
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
    const snapshot = await firebaseDb().collection(PROJECTX_CONNECTION_COLLECTION).doc(id).get();
    return toStoredConnection(snapshot.data() as StoredProjectXConnectionPayload | undefined);
  }

  const connections = await readLocalConnections();
  return toStoredConnection(connections[id]);
}

export async function saveStoredProjectXConnection(input: {
  accounts: ProjectXAccount[];
  connectedAt?: string;
  id: string;
  token: string;
  userName?: string;
}): Promise<StoredProjectXConnection> {
  const now = new Date().toISOString();
  const accounts = normalizeAccounts(input.accounts);
  const payload: StoredProjectXConnectionPayload = {
    accounts,
    accountCount: accounts.length,
    connectedAt: input.connectedAt ?? now,
    encryptedToken: encryptToken(input.token),
    id: input.id,
    lastCheckedAt: now,
    status: "connected",
    tradeableAccountCount: accounts.filter((account) => account.canTrade).length,
    updatedAt: now,
    userName: input.userName
  };

  if (hasFirebaseAdmin()) {
    await firebaseDb()
      .collection(PROJECTX_CONNECTION_COLLECTION)
      .doc(input.id)
      .set(
        {
          ...payload,
          updatedAtServer: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
  } else {
    const connections = await readLocalConnections();
    connections[input.id] = payload;
    await writeLocalConnections(connections);
  }

  return toStoredConnection(payload)!;
}

export async function deleteStoredProjectXConnection(id: string): Promise<void> {
  if (hasFirebaseAdmin()) {
    await firebaseDb().collection(PROJECTX_CONNECTION_COLLECTION).doc(id).delete();
    return;
  }

  const connections = await readLocalConnections();
  delete connections[id];
  await writeLocalConnections(connections);
}

