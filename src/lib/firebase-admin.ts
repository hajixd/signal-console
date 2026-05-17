import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

type FirebaseServiceAccount = {
  clientEmail?: string;
  client_email?: string;
  privateKey?: string;
  private_key?: string;
  privateKeyId?: string;
  private_key_id?: string;
  projectId?: string;
  project_id?: string;
};

const DEFAULT_FIREBASE_OPERATION_TIMEOUT_MS = 8_000;
const DEFAULT_FIREBASE_UNAVAILABLE_COOLDOWN_MS = 30_000;

let cachedUnavailable = false;
let cachedUnavailableUntil = 0;

function trim(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function enabledFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function disabledFlag(value: string | undefined): boolean {
  return ["0", "false", "no", "off"].includes(value?.trim().toLowerCase() ?? "");
}

function firebaseForcedLocal(): boolean {
  return enabledFlag(process.env.BACKTEST_FORCE_LOCAL) || enabledFlag(process.env.PROJECT_STORAGE_FORCE_LOCAL);
}

function firebaseOperationTimeoutMs(): number {
  const configured = Number(process.env.FIREBASE_OPERATION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 250 ? configured : DEFAULT_FIREBASE_OPERATION_TIMEOUT_MS;
}

function normalizePrivateKey(value: string | undefined): string | undefined {
  const normalized = trim(value);
  return normalized ? normalized.replace(/\\n/g, "\n") : undefined;
}

function normalizeServiceAccount(value: FirebaseServiceAccount): FirebaseServiceAccount | null {
  const clientEmail = trim(value.clientEmail ?? value.client_email);
  const privateKey = normalizePrivateKey(value.privateKey ?? value.private_key);
  const privateKeyId = trim(value.privateKeyId ?? value.private_key_id);
  const projectId = trim(value.projectId ?? value.project_id);

  if (!projectId || !clientEmail || !privateKey) return null;

  return {
    clientEmail,
    privateKey,
    privateKeyId,
    projectId
  };
}

function readServiceAccountFromJson(): FirebaseServiceAccount | null {
  const raw = trim(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as FirebaseServiceAccount;
    return normalizeServiceAccount(parsed);
  } catch (error) {
    throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

function readServiceAccount(): FirebaseServiceAccount | null {
  const fromJson = readServiceAccountFromJson();
  if (fromJson) return fromJson;

  const projectId = trim(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = trim(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  const privateKeyId = trim(process.env.FIREBASE_PRIVATE_KEY_ID);

  if (!projectId || !clientEmail || !privateKey) return null;

  return {
    clientEmail,
    privateKey,
    privateKeyId,
    projectId
  };
}

function firebaseUnavailable(): boolean {
  if (!cachedUnavailable) return false;
  if (cachedUnavailableUntil > Date.now()) return true;
  cachedUnavailable = false;
  cachedUnavailableUntil = 0;
  return false;
}

export function firebaseProjectId(): string | undefined {
  return readServiceAccount()?.projectId ?? trim(process.env.FIREBASE_PROJECT_ID);
}

export function firebaseStorageBucketName(): string {
  return trim(process.env.FIREBASE_STORAGE_BUCKET) ?? "codenames-tournament.firebasestorage.app";
}

export function firebaseStoragePrefix(): string {
  return (trim(process.env.SIGNAL_CONSOLE_STORAGE_PREFIX) ?? "signal-console").replace(/^\/+|\/+$/g, "");
}

export function storageObjectPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const prefix = firebaseStoragePrefix();
  return prefix ? `${prefix}/${normalized}` : normalized;
}

export function hasFirebaseAdmin(): boolean {
  if (firebaseForcedLocal()) return false;
  if (firebaseUnavailable()) return false;
  return Boolean(readServiceAccount() || trim(process.env.GOOGLE_APPLICATION_CREDENTIALS));
}

export function firebaseLocalFallbackEnabled(): boolean {
  const explicit = trim(process.env.FIREBASE_LOCAL_FALLBACK);
  if (explicit) return !disabledFlag(explicit);
  return firebaseForcedLocal() || process.env.VERCEL !== "1";
}

export function markFirebaseAdminUnavailable(cooldownMs = DEFAULT_FIREBASE_UNAVAILABLE_COOLDOWN_MS): void {
  cachedUnavailable = true;
  cachedUnavailableUntil = Math.max(cachedUnavailableUntil, Date.now() + cooldownMs);
}

export async function withFirebaseTimeout<T>(operation: Promise<T>, label = "Firebase operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${firebaseOperationTimeoutMs()}ms`)), firebaseOperationTimeoutMs());
  });

  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    markFirebaseAdminUnavailable();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function firebaseAdminApp() {
  if (getApps().length) return getApps()[0]!;
  if (firebaseUnavailable()) return null;

  const serviceAccount = readServiceAccount();
  const projectId = firebaseProjectId();

  try {
    return initializeApp({
      credential: serviceAccount
        ? cert({
            clientEmail: serviceAccount.clientEmail,
            privateKey: serviceAccount.privateKey,
            projectId: serviceAccount.projectId
          })
        : applicationDefault(),
      projectId,
      storageBucket: firebaseStorageBucketName()
    });
  } catch {
    markFirebaseAdminUnavailable();
    return null;
  }
}

export function firebaseDb() {
  const app = firebaseAdminApp();
  if (!app) {
    throw new Error("Firebase Admin is not configured");
  }
  return getFirestore(app);
}

export function firebaseBucket() {
  const app = firebaseAdminApp();
  if (!app) {
    throw new Error("Firebase Admin is not configured");
  }
  return getStorage(app).bucket(firebaseStorageBucketName());
}
