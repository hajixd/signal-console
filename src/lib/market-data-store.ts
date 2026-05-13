import { open } from "node:fs/promises";
import path from "node:path";
import { assetForKey } from "@/lib/assets";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath } from "@/lib/firebase-admin";
import type { Bar, StrategyRule } from "@/lib/types";

const DEFAULT_BAR_LIMIT = 1500;
const MIN_TAIL_BYTES = 512 * 1024;

function localDataPath(relativePath: string): string {
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "data",
    ...relativePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^data\/+/, "").split("/").filter(Boolean)
  );
}

async function readLocalTail(relativePath: string, byteCount: number): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(localDataPath(relativePath), "r");
    const stat = await handle.stat();
    const size = Math.min(byteCount, stat.size);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, Math.max(0, stat.size - size));
    return buffer.toString("utf8");
  } finally {
    await handle?.close();
  }
}

async function readRemoteTail(relativePath: string, byteCount: number): Promise<string> {
  const file = firebaseBucket().file(storageObjectPath(`data/${relativePath.replace(/^data\/+/, "")}`));
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  const [buffer] = await file.download({
    start: Math.max(0, size - byteCount),
    validation: false
  });
  return buffer.toString("utf8");
}

async function readDataTail(relativePath: string, byteCount: number): Promise<string> {
  if (hasFirebaseAdmin()) {
    try {
      return await readRemoteTail(relativePath, byteCount);
    } catch {
      return readLocalTail(relativePath, byteCount);
    }
  }

  return readLocalTail(relativePath, byteCount);
}

function parseBarLine(line: string): Bar | null {
  const [timeValue, openValue, highValue, lowValue, closeValue, volumeValue] = line.trim().split(",");
  const timestamp = Number(timeValue);
  const open = Number(openValue);
  const high = Number(highValue);
  const low = Number(lowValue);
  const close = Number(closeValue);
  if (![timestamp, open, high, low, close].every(Number.isFinite)) return null;
  const volume = Number(volumeValue ?? 0);

  return {
    time: new Date(timestamp * 1000).toISOString(),
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0
  };
}

function parseTailBars(text: string, limit: number): Bar[] {
  return text
    .split(/\r?\n/)
    .map((line) => (line.startsWith("time,") ? null : parseBarLine(line)))
    .filter((bar): bar is Bar => Boolean(bar))
    .slice(-limit);
}

export async function fetchStoredAssetBars(assetKey: string, limit = DEFAULT_BAR_LIMIT): Promise<Bar[]> {
  const asset = assetForKey(assetKey);
  const relativePath = `15m/${asset.dataFile}`;
  const tailBytes = Math.max(MIN_TAIL_BYTES, limit * 128);
  const bars = parseTailBars(await readDataTail(relativePath, tailBytes), limit);

  if (bars.length < Math.min(limit, 260)) {
    throw new Error(`Stored 15m data for ${asset.symbol} only had ${bars.length} readable bars.`);
  }

  return bars;
}

export async function fetchStoredMarketBars(rule: StrategyRule, limit = DEFAULT_BAR_LIMIT): Promise<Bar[]> {
  return fetchStoredAssetBars(rule.assetKey, limit);
}
