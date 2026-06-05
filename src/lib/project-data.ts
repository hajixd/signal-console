import { readFile } from "node:fs/promises";
import path from "node:path";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath, withFirebaseTimeout } from "@/lib/firebase-admin";
import { r2Configured, r2GetText, r2ObjectKey } from "@/lib/r2";

const REMOTE_TEXT_CACHE_TTL_MS = 60_000;
const remoteTextCache = new Map<string, { loadedAt: number; text: string }>();

function normalizeDataPath(relativeDataPath: string): string {
  return relativeDataPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^data\/+/, "");
}

function localDataPath(relativeDataPath: string): string {
  const normalized = normalizeDataPath(relativeDataPath);
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "data",
    ...normalized.split("/").filter(Boolean)
  );
}

async function readLocalText(relativeDataPath: string): Promise<string | null> {
  try {
    return await readFile(localDataPath(relativeDataPath), "utf8");
  } catch {
    return null;
  }
}

async function readRemoteText(relativeDataPath: string): Promise<string> {
  const objectPath = storageObjectPath(`data/${normalizeDataPath(relativeDataPath)}`);
  const cached = remoteTextCache.get(objectPath);
  const now = Date.now();
  if (cached && now - cached.loadedAt < REMOTE_TEXT_CACHE_TTL_MS) {
    return cached.text;
  }

  const [buffer] = await withFirebaseTimeout(firebaseBucket().file(objectPath).download(), `Firebase data read ${objectPath}`);
  const text = buffer.toString("utf8");
  remoteTextCache.set(objectPath, { loadedAt: now, text });
  return text;
}

export async function readDataText(relativeDataPath: string): Promise<string> {
  if (r2Configured()) {
    const objectPath = `data/${normalizeDataPath(relativeDataPath)}`;
    const cached = remoteTextCache.get(r2ObjectKey(objectPath));
    const now = Date.now();
    if (cached && now - cached.loadedAt < REMOTE_TEXT_CACHE_TTL_MS) {
      return cached.text;
    }
    try {
      const text = await r2GetText(objectPath);
      if (text !== null) {
        remoteTextCache.set(r2ObjectKey(objectPath), { loadedAt: now, text });
        return text;
      }
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      return await readRemoteText(relativeDataPath);
    } catch {
      const local = await readLocalText(relativeDataPath);
      if (local !== null) return local;
      throw new Error(`Missing data asset: ${relativeDataPath}`);
    }
  }

  const local = await readLocalText(relativeDataPath);
  if (local !== null) return local;
  throw new Error(`Missing data asset: ${relativeDataPath}`);
}
