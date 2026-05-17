import { readFile } from "node:fs/promises";
import path from "node:path";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath, withFirebaseTimeout } from "@/lib/firebase-admin";

const REMOTE_TEXT_CACHE_TTL_MS = 60_000;
const remoteTextCache = new Map<string, { loadedAt: number; text: string }>();
type AssetReadMode = "auto" | "local" | "remote";

function localPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const [root, ...rest] = normalized.split("/");
  if (!root || !rest.length || rest.some((part) => part === ".." || part === "")) {
    throw new Error(`Unsupported project asset path: ${relativePath}`);
  }
  const tail = rest.join("/");

  switch (root) {
    case "cache":
      return path.join(/*turbopackIgnore: true*/ process.cwd(), "cache", tail);
    case "config":
      return path.join(/*turbopackIgnore: true*/ process.cwd(), "config", tail);
    case "data":
      return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", tail);
    case "strategy":
      return path.join(/*turbopackIgnore: true*/ process.cwd(), "strategy", tail);
    default:
      throw new Error(`Unsupported project asset root: ${root ?? "(empty)"}`);
  }
}

async function readLocalText(relativePath: string): Promise<string | null> {
  try {
    return await readFile(localPath(relativePath), "utf8");
  } catch {
    return null;
  }
}

async function readRemoteText(relativePath: string): Promise<string> {
  const objectPath = storageObjectPath(relativePath);
  const cached = remoteTextCache.get(objectPath);
  const now = Date.now();
  if (cached && now - cached.loadedAt < REMOTE_TEXT_CACHE_TTL_MS) {
    return cached.text;
  }

  const [buffer] = await withFirebaseTimeout(firebaseBucket().file(objectPath).download(), `Firebase asset read ${objectPath}`);
  const text = buffer.toString("utf8");
  remoteTextCache.set(objectPath, { loadedAt: now, text });
  return text;
}

export async function readProjectText(relativePath: string, mode: AssetReadMode = "auto"): Promise<string> {
  const normalized = relativePath.replace(/\\/g, "/");

  if (mode !== "local" && hasFirebaseAdmin()) {
    try {
      return await readRemoteText(normalized);
    } catch {
      if (mode === "remote") {
        throw new Error(`Missing remote project asset: ${normalized}`);
      }
      const local = await readLocalText(normalized);
      if (local !== null) return local;
      throw new Error(`Missing project asset: ${normalized}`);
    }
  }

  const local = await readLocalText(normalized);
  if (local !== null) return local;
  throw new Error(`Missing project asset: ${normalized}`);
}

export async function readProjectTextIfExists(relativePath: string, mode: AssetReadMode = "auto"): Promise<string | null> {
  try {
    return await readProjectText(relativePath, mode);
  } catch {
    return null;
  }
}

export function projectAssetMode(): "firebase" | "local" {
  return hasFirebaseAdmin() ? "firebase" : "local";
}
