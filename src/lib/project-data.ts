import { readFile } from "node:fs/promises";
import path from "node:path";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath } from "@/lib/firebase-admin";

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

  const [buffer] = await firebaseBucket().file(objectPath).download();
  const text = buffer.toString("utf8");
  remoteTextCache.set(objectPath, { loadedAt: now, text });
  return text;
}

export async function readDataText(relativeDataPath: string): Promise<string> {
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
