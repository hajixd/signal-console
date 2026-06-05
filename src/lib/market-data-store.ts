import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { assetForKey } from "@/lib/assets";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath } from "@/lib/firebase-admin";
import { fetchMarketBars } from "@/lib/market-data";
import { r2Configured, r2GetTailText, r2GetText } from "@/lib/r2";
import {
  closedBarStartSeconds,
  DEFAULT_STRATEGY_TIMEFRAME,
  timeframeFromVariant,
  timeframeSeconds,
  type DataTimeframe
} from "@/lib/timeframes";
import type { Bar, StrategyRule } from "@/lib/types";

const DEFAULT_BAR_LIMIT = 1500;
const MIN_TAIL_BYTES = 512 * 1024;
const LIVE_DATA_TAILS_PATH = "cache/live-data-tails.json";

type CachedBar = [string, number, number, number, number, number?];
type LiveDataTailCache = {
  barLimit?: number;
  files?: Record<string, CachedBar[]>;
  generatedAt?: string;
};

let liveDataTailCache: Promise<LiveDataTailCache | null> | null = null;

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
  if (r2Configured()) {
    try {
      const text = await r2GetTailText(`data/${relativePath.replace(/^data\/+/, "")}`, byteCount);
      if (text !== null) return text;
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

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

function localCachePath(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "cache", "live-data-tails.json");
}

function configuredSignalStaleMs(timeframe: DataTimeframe): number | null {
  const minutes = Number(process.env.LIVE_SIGNAL_STALE_MINUTES ?? process.env.MARKET_DATA_STALE_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.max(minutes * 60_000, timeframeSeconds(timeframe) * 1000);
}

function barTimeMs(bar: Bar): number | null {
  const time = Date.parse(bar.time);
  return Number.isFinite(time) ? time : null;
}

function latestBarMs(bars: Bar[]): number | null {
  let latest: number | null = null;
  for (const bar of bars) {
    const time = barTimeMs(bar);
    if (time == null) continue;
    latest = latest == null ? time : Math.max(latest, time);
  }
  return latest;
}

function hasFreshSignalBars(bars: Bar[], timeframe: DataTimeframe): boolean {
  const latest = latestBarMs(bars);
  if (latest == null) return false;

  const configuredStaleMs = configuredSignalStaleMs(timeframe);
  if (configuredStaleMs !== null) {
    return Date.now() - latest <= configuredStaleMs;
  }

  return latest >= closedBarStartSeconds(timeframe) * 1000;
}

function mergeBars(storedBars: Bar[], liveBars: Bar[], limit: number): Bar[] {
  const byTime = new Map<string, Bar>();
  for (const bar of [...storedBars, ...liveBars]) {
    if (barTimeMs(bar) == null) continue;
    byTime.set(bar.time, bar);
  }

  return [...byTime.values()]
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
    .slice(-limit);
}

async function readLiveDataTailCache(): Promise<LiveDataTailCache | null> {
  if (!liveDataTailCache) {
    liveDataTailCache = (async () => {
      let raw: string | null = null;
      if (r2Configured()) {
        raw = await r2GetText(LIVE_DATA_TAILS_PATH).catch(() => null);
      }
      if (!raw && hasFirebaseAdmin()) {
        try {
          const [buffer] = await firebaseBucket().file(storageObjectPath(LIVE_DATA_TAILS_PATH)).download();
          raw = buffer.toString("utf8");
        } catch {
          raw = null;
        }
      }
      if (!raw) {
        raw = await readFile(localCachePath(), "utf8").catch(() => null);
      }
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as LiveDataTailCache;
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    })();
  }

  return liveDataTailCache;
}

async function readCachedBars(relativePath: string, limit: number): Promise<Bar[]> {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^data\/+/, "");
  const cache = await readLiveDataTailCache();
  const rows = cache?.files?.[normalized];
  if (!Array.isArray(rows)) return [];

  return rows
    .slice(-limit)
    .map(([time, open, high, low, close, volume]) => ({
      time,
      open,
      high,
      low,
      close,
      volume: volume ?? 0
    }))
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
}

async function loadStoredBars(relativePath: string, limit: number, tailBytes: number): Promise<Bar[]> {
  try {
    const bars = parseTailBars(await readDataTail(relativePath, tailBytes), limit);
    if (bars.length >= Math.min(limit, 260)) return bars;
  } catch {
    // Fall through to the deploy-time cache.
  }

  return readCachedBars(relativePath, limit);
}

export async function fetchStoredAssetBars(
  assetKey: string,
  limit = DEFAULT_BAR_LIMIT,
  timeframe: DataTimeframe = DEFAULT_STRATEGY_TIMEFRAME
): Promise<Bar[]> {
  const asset = assetForKey(assetKey);
  const relativePath = `${timeframe}/${asset.dataFile}`;
  const tailBytes = Math.max(MIN_TAIL_BYTES, limit * 128);
  const bars = await loadStoredBars(relativePath, limit, tailBytes);

  if (bars.length < Math.min(limit, 260)) {
    throw new Error(`Stored ${timeframe} data for ${asset.symbol} only had ${bars.length} readable bars.`);
  }

  return bars;
}

export async function fetchStoredMarketBars(rule: StrategyRule, limit = DEFAULT_BAR_LIMIT): Promise<Bar[]> {
  const timeframe = timeframeFromVariant(rule.variantId, DEFAULT_STRATEGY_TIMEFRAME);
  let storedBars: Bar[] = [];
  let storedError: unknown;

  try {
    storedBars = await fetchStoredAssetBars(rule.assetKey, limit, timeframe);
    if (hasFreshSignalBars(storedBars, timeframe)) return storedBars;
  } catch (error) {
    storedError = error;
  }

  try {
    const latestStored = latestBarMs(storedBars);
    const liveBars = await fetchMarketBars(rule, latestStored ? { afterSeconds: Math.floor(latestStored / 1000) } : {});
    const merged = mergeBars(storedBars, liveBars, limit);
    if (merged.length >= Math.min(limit, 260) && hasFreshSignalBars(merged, timeframe)) return merged;
    const latest = latestBarMs(merged);
    throw new Error(
      latest
        ? `Live data for ${rule.symbol} is stale; latest ${timeframe} bar is ${new Date(latest).toISOString()}.`
        : `Live data for ${rule.symbol} did not include readable ${timeframe} bars.`
    );
  } catch (error) {
    if (storedBars.length >= Math.min(limit, 260)) {
      const latest = latestBarMs(storedBars);
      throw new Error(
        latest
          ? `Stored ${timeframe} data for ${rule.symbol} is stale at ${new Date(latest).toISOString()} and provider refresh failed: ${error instanceof Error ? error.message : "Unknown provider error"}`
          : `Stored ${timeframe} data for ${rule.symbol} had no readable timestamps and provider refresh failed: ${error instanceof Error ? error.message : "Unknown provider error"}`
      );
    }
    if (storedError instanceof Error) throw storedError;
    throw error;
  }
}
