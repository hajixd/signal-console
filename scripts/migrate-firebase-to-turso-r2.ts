import { firebaseBucket, firebaseDb, hasFirebaseAdmin, storageObjectPath, withFirebaseTimeout } from "../src/lib/firebase-admin";
import { r2Configured, r2HeadObject, r2PutObject } from "../src/lib/r2";
import { missingTursoEnv, saveTursoDocument, tursoConfigured } from "../src/lib/turso";

const DEFAULT_COLLECTIONS = [
  "signalConsoleAlerts",
  "signalConsoleConfig",
  "signalConsoleDatasets",
  "signalConsoleCronRuns",
  "topstepProjectXConnections",
  "autoTradeConnections",
  "signalConsoleWeeklySummaries",
  "signalConsoleDailySummaries",
  "signalConsoleChallengeReplayCache",
  "signalConsoleSimpleStrategies",
  "signalConsoleSimpleStrategyImports",
  "competitionStrategies",
  "competitionStrategyRuns"
];

const DEFAULT_STORAGE_ROOTS = ["cache", "config", "data", "Research", "strategy"];
const SORT_TIME_KEYS = [
  "updatedAt",
  "createdAt",
  "closedAt",
  "finishedAt",
  "startedAt",
  "alertAt",
  "signalTime",
  "entryTime",
  "exitTime",
  "lastSyncAt",
  "generatedAt",
  "timestamp",
  "time"
];
const DEFAULT_FIRESTORE_WRITE_CONCURRENCY = 12;

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim();
}

function csvArg(name: string, fallback: string[]): string[] {
  const raw = argValue(name);
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function firestoreOnlyRequested(): boolean {
  return process.argv.includes("--firestore-only");
}

function storageOnlyRequested(): boolean {
  return process.argv.includes("--storage-only");
}

function changedOnlyRequested(): boolean {
  return process.argv.includes("--changed-only");
}

function selectedFirestoreWriteConcurrency(): number {
  const raw = Number(argValue("firestore-write-concurrency"));
  return Number.isInteger(raw) && raw > 0 ? Math.min(raw, 32) : DEFAULT_FIRESTORE_WRITE_CONCURRENCY;
}

function contentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function relativePathFromStorageName(name: string): string | null {
  const rootPrefix = storageObjectPath("");
  const prefix = rootPrefix ? `${rootPrefix.replace(/\/+$/, "")}/` : "";
  if (prefix && !name.startsWith(prefix)) return null;
  return name.slice(prefix.length).replace(/^\/+/, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function millisFromValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.round(value) : Math.round(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const record = value as {
    _nanoseconds?: number;
    _seconds?: number;
    nanoseconds?: number;
    seconds?: number;
    toDate?: () => Date;
    toMillis?: () => number;
  };
  if (typeof record?.toMillis === "function") {
    const millis = record.toMillis();
    return Number.isFinite(millis) ? Math.round(millis) : undefined;
  }
  if (typeof record?.toDate === "function") {
    const millis = record.toDate().getTime();
    return Number.isFinite(millis) ? millis : undefined;
  }

  const seconds = record?._seconds ?? record?.seconds;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return Math.round(seconds * 1000);
  }

  return undefined;
}

function normalizeFirestoreValue(value: unknown): unknown {
  const millis = millisFromValue(value);
  if (millis !== undefined && typeof value !== "number" && typeof value !== "string") {
    return new Date(millis).toISOString();
  }
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
  if (!isPlainObject(value)) return String(value);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => typeof entryValue !== "function" && entryValue !== undefined)
      .map(([key, entryValue]) => [key, normalizeFirestoreValue(entryValue)])
  );
}

function sortTimeMillisFromPayload(payload: Record<string, unknown>): number | undefined {
  for (const key of SORT_TIME_KEYS) {
    const millis = millisFromValue(payload[key]);
    if (millis !== undefined) return millis;
  }
  return undefined;
}

async function migrateFirestoreCollections(collections: string[]): Promise<number> {
  if (!hasFirebaseAdmin()) {
    throw new Error("Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or the split FIREBASE_* variables first.");
  }
  if (!tursoConfigured()) {
    throw new Error(`Turso is not configured. Missing env vars: ${missingTursoEnv().join(", ")}`);
  }

  let copied = 0;
  const concurrency = selectedFirestoreWriteConcurrency();
  for (const collection of collections) {
    const snapshot = await withFirebaseTimeout(firebaseDb().collection(collection).get(), `Firebase collection read ${collection}`);
    let collectionCopied = 0;

    for (let index = 0; index < snapshot.docs.length; index += concurrency) {
      const chunk = snapshot.docs.slice(index, index + concurrency);
      await Promise.all(
        chunk.map(async (doc) => {
          const payload = normalizeFirestoreValue(doc.data()) as Record<string, unknown>;
          await saveTursoDocument({
            collection,
            id: doc.id,
            payload,
            sortTimeMillis: sortTimeMillisFromPayload(payload)
          });
        })
      );
      copied += chunk.length;
      collectionCopied += chunk.length;
      if (collectionCopied % 240 === 0 || collectionCopied === snapshot.docs.length) {
        console.log(`copied collection ${collection}: ${collectionCopied}/${snapshot.docs.length} document(s)`);
      }
    }
  }
  return copied;
}

async function migrateStorageRoots(roots: string[]): Promise<number> {
  if (!hasFirebaseAdmin()) {
    throw new Error("Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or the split FIREBASE_* variables first.");
  }
  if (!r2Configured()) {
    throw new Error("R2 is not configured. Set R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY first.");
  }

  let copied = 0;
  let skipped = 0;
  for (const root of roots) {
    const [files] = await firebaseBucket().getFiles({ prefix: storageObjectPath(root) });
    for (const file of files) {
      const relativePath = relativePathFromStorageName(file.name);
      if (!relativePath) continue;

      const [metadata] = await file.getMetadata();
      const size = Number(metadata.size ?? 0);
      if (changedOnlyRequested() && Number.isFinite(size)) {
        const existing = await r2HeadObject(relativePath);
        if (existing?.contentLength === size) {
          skipped += 1;
          continue;
        }
      }

      await r2PutObject(relativePath, file.createReadStream({ validation: false }), {
        contentLength: Number.isFinite(size) ? size : undefined,
        contentType: contentType(relativePath)
      });
      copied += 1;
      console.log(`copied object ${relativePath}`);
    }
  }

  if (skipped) console.log(`skipped unchanged object(s): ${skipped}`);
  return copied;
}

async function main(): Promise<void> {
  if (firestoreOnlyRequested() && storageOnlyRequested()) {
    throw new Error("Choose either --firestore-only or --storage-only, not both.");
  }

  const collections = csvArg("collections", DEFAULT_COLLECTIONS);
  const storageRoots = csvArg("storage-roots", DEFAULT_STORAGE_ROOTS);
  let documentsCopied = 0;
  let objectsCopied = 0;

  if (!storageOnlyRequested()) {
    documentsCopied = await migrateFirestoreCollections(collections);
  }
  if (!firestoreOnlyRequested()) {
    objectsCopied = await migrateStorageRoots(storageRoots);
  }

  console.log(`migration complete: ${documentsCopied} document(s), ${objectsCopied} object(s)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
