import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseDb, hasFirebaseAdmin } from "@/lib/firebase-admin";
import { omitUndefinedDeep } from "@/lib/firestore-utils";
import type { ChallengeReplaySummary } from "@/lib/challenge";

const CHALLENGE_REPLAY_CACHE_COLLECTION = "signalConsoleChallengeReplayCache";
const CHALLENGE_REPLAY_CACHE_LOCAL_PATH = path.join(process.cwd(), ".local", "signal-console-challenge-replay-cache.json");
const CHALLENGE_REPLAY_CACHE_LIMIT = 80;
const CHALLENGE_REPLAY_CACHE_KEY_PATTERN = /^[a-z0-9_-]{12,140}$/i;

type ChallengeReplayCacheEntry = {
  createdAt: string;
  key: string;
  summary: ChallengeReplaySummary;
  updatedAt: string;
};

function validCacheKey(key: string): boolean {
  return CHALLENGE_REPLAY_CACHE_KEY_PATTERN.test(key);
}

function isChallengeReplaySummary(value: unknown): value is ChallengeReplaySummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<ChallengeReplaySummary>;
  return (
    typeof summary.eligibleTrades === "number" &&
    typeof summary.historicalSessions === "number" &&
    Boolean(summary.historical && typeof summary.historical === "object") &&
    Boolean(summary.monteCarlo && typeof summary.monteCarlo === "object") &&
    Array.isArray(summary.historicalPassRates) &&
    Array.isArray(summary.monteCarloPassRates)
  );
}

function normalizeEntry(key: string, value: unknown): ChallengeReplayCacheEntry | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<ChallengeReplayCacheEntry>;
  if (!isChallengeReplaySummary(source.summary)) return null;

  return {
    createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date(0).toISOString(),
    key,
    summary: source.summary,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date(0).toISOString()
  };
}

async function readLocalCache(): Promise<Record<string, ChallengeReplayCacheEntry>> {
  try {
    const raw = await readFile(CHALLENGE_REPLAY_CACHE_LOCAL_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key]) => validCacheKey(key))
        .map(([key, value]) => [key, normalizeEntry(key, value)] as const)
        .filter((entry): entry is readonly [string, ChallengeReplayCacheEntry] => Boolean(entry[1]))
    );
  } catch {
    return {};
  }
}

async function writeLocalCache(entries: Record<string, ChallengeReplayCacheEntry>): Promise<void> {
  const pruned = Object.fromEntries(
    Object.entries(entries)
      .sort(([, left], [, right]) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, CHALLENGE_REPLAY_CACHE_LIMIT)
  );
  await mkdir(path.dirname(CHALLENGE_REPLAY_CACHE_LOCAL_PATH), { recursive: true });
  await writeFile(CHALLENGE_REPLAY_CACHE_LOCAL_PATH, JSON.stringify(pruned, null, 2));
}

export async function getCachedChallengeReplay(key: string): Promise<ChallengeReplaySummary | null> {
  if (!validCacheKey(key)) return null;

  if (hasFirebaseAdmin()) {
    const snapshot = await firebaseDb().collection(CHALLENGE_REPLAY_CACHE_COLLECTION).doc(key).get();
    const entry = normalizeEntry(key, snapshot.data());
    return entry?.summary ?? null;
  }

  const localCache = await readLocalCache();
  return localCache[key]?.summary ?? null;
}

export async function saveCachedChallengeReplay(key: string, summary: ChallengeReplaySummary): Promise<void> {
  if (!validCacheKey(key) || !isChallengeReplaySummary(summary)) return;

  const now = new Date().toISOString();
  const entry: ChallengeReplayCacheEntry = {
    createdAt: now,
    key,
    summary,
    updatedAt: now
  };
  const payload = omitUndefinedDeep(entry);

  if (hasFirebaseAdmin()) {
    await firebaseDb()
      .collection(CHALLENGE_REPLAY_CACHE_COLLECTION)
      .doc(key)
      .set({
        ...payload,
        updatedAtServer: FieldValue.serverTimestamp()
      });
    return;
  }

  const localCache = await readLocalCache();
  const existing = localCache[key];
  await writeLocalCache({
    ...localCache,
    [key]: {
      ...entry,
      createdAt: existing?.createdAt ?? entry.createdAt
    }
  });
}
