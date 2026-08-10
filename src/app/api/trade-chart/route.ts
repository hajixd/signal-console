import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { assetForSymbol, isMarket } from "@/lib/assets";
import { fetchMarketSourceBars } from "@/lib/market-data";
import { readDataText } from "@/lib/project-data";
import { fetchProjectXMarketDataBars } from "@/lib/projectx-market-data";
import {
  LIVE_SOURCE_TIMEFRAME,
  floorToTimeframeSeconds,
  isDataTimeframe,
  timeframeSeconds,
  type DataTimeframe
} from "@/lib/timeframes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MarketBar = {
  index: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

const LINE_CACHE_TTL_MS = 5 * 60_000;
const BOUNDARY_CACHE_TTL_MS = 15 * 60_000;
const MAX_LINE_CACHE_ENTRIES = 12;
const MAX_BOUNDARY_CACHE_ENTRIES = 48;

const lineCache = new Map<string, { loadedAt: number; lines: string[] }>();
const boundaryCache = new Map<string, { loadedAt: number; boundary: { first: number; last: number } | null }>();
const TIMEFRAME_ORDER = ["1m", "5m", "10m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"] as const;
const SUPPORTED_TIMEFRAMES = new Set<string>(TIMEFRAME_ORDER);
const TIMEFRAME_SECONDS: Record<(typeof TIMEFRAME_ORDER)[number], number> = {
  "1m": 60,
  "5m": 5 * 60,
  "10m": 10 * 60,
  "15m": 15 * 60,
  "30m": 30 * 60,
  "45m": 45 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60
};
const DEFAULT_TIMEFRAME = "1m";
const DEFAULT_CONTEXT_CANDLES = 240;
const MAX_CONTEXT_CANDLES = 1000;
const LIVE_FALLBACK_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
const PRIMARY_PROVIDER_COOLDOWN_MS = 10 * 60_000;
let primaryProviderUnavailableUntil = 0;

function chartTimeframe(value: string | null): string {
  return value && SUPPORTED_TIMEFRAMES.has(value) ? value : DEFAULT_TIMEFRAME;
}

function contextCandles(value: string | null): number {
  return Math.max(8, Math.min(MAX_CONTEXT_CANDLES, Math.round(numericParam(value, DEFAULT_CONTEXT_CANDLES))));
}

async function marketLines(relativePath: string): Promise<string[]> {
  const cached = lineCache.get(relativePath);
  if (cached && Date.now() - cached.loadedAt < LINE_CACHE_TTL_MS) return cached.lines;
  if (cached) lineCache.delete(relativePath);
  const text = await readChartDataText(relativePath);
  const lines = text.trim().split(/\r?\n/);
  lineCache.set(relativePath, { loadedAt: Date.now(), lines });
  while (lineCache.size > MAX_LINE_CACHE_ENTRIES) {
    const oldestKey = lineCache.keys().next().value;
    if (!oldestKey) break;
    lineCache.delete(oldestKey);
  }
  return lines;
}

function numericParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timeframeCandidates(timeframe: string): string[] {
  const startIndex = TIMEFRAME_ORDER.indexOf(timeframe as (typeof TIMEFRAME_ORDER)[number]);
  if (startIndex < 0) return [DEFAULT_TIMEFRAME];

  return [
    ...TIMEFRAME_ORDER.slice(startIndex),
    ...TIMEFRAME_ORDER.slice(0, startIndex).reverse()
  ];
}

function maxNearestDistanceSeconds(timeframe: string): number {
  return TIMEFRAME_SECONDS[timeframe as (typeof TIMEFRAME_ORDER)[number]] ?? TIMEFRAME_SECONDS[DEFAULT_TIMEFRAME];
}

function localDataPath(relativePath: string): string {
  return path.join(
    process.cwd(),
    "data",
    ...relativePath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^data\/+/, "").split("/").filter(Boolean)
  );
}

async function readChartDataText(relativePath: string): Promise<string> {
  if (process.env.NODE_ENV !== "production") {
    try {
      return await readFile(localDataPath(relativePath), "utf8");
    } catch {
      return readDataText(relativePath);
    }
  }

  return readDataText(relativePath);
}

function parsedTimestamp(line: string | undefined): number | null {
  if (!line) return null;
  const timestamp = Number(line.split(",", 1)[0]);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function nextLineBreak(text: string, start: number): number {
  const lineFeed = text.indexOf("\n", start);
  return lineFeed >= 0 ? lineFeed : text.length;
}

async function localFileBoundary(relativePath: string): Promise<{ first: number; last: number } | null> {
  const cached = boundaryCache.get(relativePath);
  if (cached && Date.now() - cached.loadedAt < BOUNDARY_CACHE_TTL_MS) return cached.boundary;
  if (cached) boundaryCache.delete(relativePath);

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(localDataPath(relativePath), "r");
    const stat = await handle.stat();
    const headSize = Math.min(4096, stat.size);
    const tailSize = Math.min(65536, stat.size);
    const head = Buffer.alloc(headSize);
    const tail = Buffer.alloc(tailSize);
    await handle.read(head, 0, headSize, 0);
    await handle.read(tail, 0, tailSize, Math.max(0, stat.size - tailSize));

    const first = head
      .toString("utf8")
      .split(/\r?\n/)
      .slice(1)
      .map(parsedTimestamp)
      .find((timestamp): timestamp is number => timestamp !== null);
    const last = tail
      .toString("utf8")
      .trim()
      .split(/\r?\n/)
      .reverse()
      .map(parsedTimestamp)
      .find((timestamp): timestamp is number => timestamp !== null);
    const boundary = first != null && last != null ? { first, last } : null;
    boundaryCache.set(relativePath, { loadedAt: Date.now(), boundary });
    while (boundaryCache.size > MAX_BOUNDARY_CACHE_ENTRIES) {
      const oldestKey = boundaryCache.keys().next().value;
      if (!oldestKey) break;
      boundaryCache.delete(oldestKey);
    }
    return boundary;
  } catch {
    boundaryCache.set(relativePath, { loadedAt: Date.now(), boundary: null });
    return null;
  } finally {
    await handle?.close();
  }
}

function secondsFromSearchTime(rawTime: string | null): number | null {
  const parsed = rawTime ? Date.parse(rawTime) : NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

async function localFileMightCoverTrade(
  relativePath: string,
  entryTime: string | null,
  exitTime: string | null,
  timeframe: string
): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return true;

  const boundary = await localFileBoundary(relativePath);
  if (!boundary) return true;

  const tolerance = maxNearestDistanceSeconds(timeframe);
  const targets = [secondsFromSearchTime(entryTime), secondsFromSearchTime(exitTime)].filter(
    (value): value is number => value !== null
  );

  return targets.every((target) => target >= boundary.first - tolerance && target <= boundary.last + tolerance);
}

async function localLineAtOrAfter(
  handle: Awaited<ReturnType<typeof open>>,
  fileSize: number,
  position: number
): Promise<{ line: string; offset: number; timestamp: number } | null> {
  const chunkSize = Math.min(16_384, Math.max(0, fileSize - position));
  if (chunkSize <= 0) return null;

  const buffer = Buffer.alloc(chunkSize);
  const { bytesRead } = await handle.read(buffer, 0, chunkSize, position);
  if (bytesRead <= 0) return null;

  const text = buffer.subarray(0, bytesRead).toString("utf8");
  let lineStart = position === 0 ? 0 : text.indexOf("\n") + 1;
  if (lineStart <= 0) return null;

  while (lineStart < text.length) {
    const lineEnd = nextLineBreak(text, lineStart);
    const line = text.slice(lineStart, lineEnd).trim();
    const timestamp = parsedTimestamp(line);
    if (timestamp != null) {
      return {
        line,
        offset: position + lineStart,
        timestamp
      };
    }
    lineStart = lineEnd + 1;
  }

  return null;
}

async function localOffsetForTimestamp(
  handle: Awaited<ReturnType<typeof open>>,
  fileSize: number,
  targetSeconds: number
): Promise<number | null> {
  let left = 0;
  let right = Math.max(0, fileSize - 1);
  let bestOffset: number | null = null;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const sample = await localLineAtOrAfter(handle, fileSize, middle);
    if (!sample) {
      right = middle - 1;
      continue;
    }

    if (sample.timestamp < targetSeconds) {
      left = Math.max(middle + 1, sample.offset + sample.line.length + 1);
    } else {
      bestOffset = sample.offset;
      right = middle - 1;
    }
  }

  if (bestOffset != null) return bestOffset;
  return (await localLineAtOrAfter(handle, fileSize, 0))?.offset ?? null;
}

async function localWindowBars(
  relativePath: string,
  context: number,
  entryTime: string | null,
  exitTime: string | null,
  timeframe: string
): Promise<MarketBar[] | null> {
  const entrySeconds = secondsFromSearchTime(entryTime);
  const exitSeconds = secondsFromSearchTime(exitTime);
  if (entrySeconds == null || exitSeconds == null) return null;

  const timeframeSeconds = maxNearestDistanceSeconds(timeframe);
  return localBarsInTimeWindow(
    relativePath,
    Math.min(entrySeconds, exitSeconds) - context * timeframeSeconds,
    Math.max(entrySeconds, exitSeconds) + context * timeframeSeconds
  );
}

async function localBarsInTimeWindow(relativePath: string, startSeconds: number, endSeconds: number): Promise<MarketBar[] | null> {
  if (process.env.NODE_ENV === "production") return null;

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(localDataPath(relativePath), "r");
    const stat = await handle.stat();
    const startOffset = await localOffsetForTimestamp(handle, stat.size, startSeconds);
    if (startOffset == null) return null;

    const bars: MarketBar[] = [];
    const chunkSize = 131_072;
    let position = startOffset;
    let remainder = "";
    let done = false;

    while (!done && position < stat.size) {
      const buffer = Buffer.alloc(Math.min(chunkSize, stat.size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead <= 0) break;
      position += bytesRead;

      const text = remainder + buffer.subarray(0, bytesRead).toString("utf8");
      const lines = text.split(/\r?\n/);
      remainder = lines.pop() ?? "";

      for (const line of lines) {
        const timestamp = parsedTimestamp(line);
        if (timestamp == null || timestamp < startSeconds) continue;
        if (timestamp > endSeconds) {
          done = true;
          break;
        }

        const bar = parseBar(line, bars.length);
        if (bar) bars.push(bar);
      }
    }

    if (!done && remainder) {
      const timestamp = parsedTimestamp(remainder);
      if (timestamp != null && timestamp >= startSeconds && timestamp <= endSeconds) {
        const bar = parseBar(remainder, bars.length);
        if (bar) bars.push(bar);
      }
    }

    return bars.length ? bars : null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

async function barsInTimeWindow(relativePath: string, startSeconds: number, endSeconds: number): Promise<MarketBar[] | null> {
  const localBars = await localBarsInTimeWindow(relativePath, startSeconds, endSeconds);
  if (localBars) return localBars;

  try {
    const lines = await marketLines(relativePath);
    const startIndex = indexAtOrBefore(lines, startSeconds) ?? 0;
    const endIndex = indexAtOrBefore(lines, endSeconds) ?? Math.max(0, lines.length - 2);
    const bars: MarketBar[] = [];

    for (let index = Math.max(0, startIndex); index <= endIndex; index += 1) {
      const bar = parseBar(lines[index + 1] ?? "", bars.length);
      if (bar) bars.push(bar);
    }

    return bars.length ? bars : null;
  } catch {
    return null;
  }
}

async function replayBarsForTradeWindow({
  assetDataFile,
  context,
  entryTime,
  exitTime,
  selectedTimeframe
}: {
  assetDataFile: string;
  context: number;
  entryTime: string | null;
  exitTime: string | null;
  selectedTimeframe: string;
}): Promise<MarketBar[] | null> {
  if (selectedTimeframe === "1m") return null;

  const entrySeconds = secondsFromSearchTime(entryTime);
  const exitSeconds = secondsFromSearchTime(exitTime);
  if (entrySeconds == null || exitSeconds == null) return null;

  const timeframeSeconds = maxNearestDistanceSeconds(selectedTimeframe);
  const filePath = `1m/${assetDataFile}`;
  const hasLocalCoverage = await localFileMightCoverTrade(filePath, entryTime, exitTime, "1m");
  if (!hasLocalCoverage) return null;

  const replayContextSeconds = Math.min(3 * 24 * 60 * 60, Math.max(6 * 60 * 60, context * timeframeSeconds));
  return barsInTimeWindow(
    filePath,
    Math.min(entrySeconds, exitSeconds) - replayContextSeconds,
    Math.max(entrySeconds, exitSeconds) + replayContextSeconds
  );
}

function parseBar(line: string, index: number): MarketBar | null {
  const [timeValue, openValue, highValue, lowValue, closeValue, volumeValue] = line.split(",");
  const timestamp = Number(timeValue);
  const open = Number(openValue);
  const high = Number(highValue);
  const low = Number(lowValue);
  const close = Number(closeValue);
  if (![timestamp, open, high, low, close].every(Number.isFinite)) return null;
  const volume = Number(volumeValue);
  return {
    index,
    time: new Date(timestamp * 1000).toISOString(),
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : undefined
  };
}

function timestampForLine(line: string | undefined): number | null {
  return parsedTimestamp(line);
}

function indexAtOrBefore(lines: string[], targetSeconds: number): number | null {
  const lastIndex = lines.length - 2;
  if (lastIndex < 0 || !Number.isFinite(targetSeconds)) return null;

  let left = 0;
  let right = lastIndex;
  let best: number | null = null;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const timestamp = timestampForLine(lines[middle + 1]);
    if (timestamp == null) break;

    if (timestamp <= targetSeconds) {
      best = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  return best;
}

function nearestIndexForTime(lines: string[], rawTime: string | null, fallbackIndex: number, timeframe: string): number | null {
  const parsed = rawTime ? Date.parse(rawTime) : NaN;
  if (!Number.isFinite(parsed)) return fallbackIndex;

  const lastIndex = Math.max(0, lines.length - 2);
  const targetSeconds = Math.floor(parsed / 1000);
  const before = indexAtOrBefore(lines, targetSeconds);
  if (before == null) return null;

  const candidates = [before, Math.min(lastIndex, before + 1)];
  let bestIndex = before;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const timestamp = timestampForLine(lines[candidate + 1]);
    if (timestamp == null) continue;
    const distance = Math.abs(timestamp - targetSeconds);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = candidate;
    }
  }

  if (bestDistance > maxNearestDistanceSeconds(timeframe)) return null;

  return bestIndex;
}

async function barsForTimeframe({
  context,
  entryIndex,
  entryTime,
  exitIndex,
  exitTime,
  filePath,
  timeframe
}: {
  context: number;
  entryIndex: number;
  entryTime: string | null;
  exitIndex: number;
  exitTime: string | null;
  filePath: string;
  timeframe: string;
}): Promise<MarketBar[] | null> {
  const hasLocalCoverage = await localFileMightCoverTrade(filePath, entryTime, exitTime, timeframe);
  if (!hasLocalCoverage) return null;

  const localBars = await localWindowBars(filePath, context, entryTime, exitTime, timeframe);
  if (localBars) return localBars;

  const lines = await marketLines(filePath);
  const lastIndex = Math.max(0, lines.length - 2);
  const resolvedEntryIndex = nearestIndexForTime(lines, entryTime, entryIndex, timeframe);
  const resolvedExitIndex = nearestIndexForTime(lines, exitTime, exitIndex, timeframe);
  if (resolvedEntryIndex == null || resolvedExitIndex == null) return null;

  const tradeStart = Math.min(resolvedEntryIndex, resolvedExitIndex);
  const tradeEnd = Math.max(resolvedEntryIndex, resolvedExitIndex);
  const startIndex = Math.max(0, tradeStart - context);
  const endIndex = Math.min(lastIndex, tradeEnd + context);
  const bars: MarketBar[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    const bar = parseBar(lines[index + 1] ?? "", index);
    if (bar) bars.push(bar);
  }

  return bars;
}

function aggregateProviderBars(
  bars: Array<{ time: string; open: number; high: number; low: number; close: number; volume?: number }>,
  timeframe: DataTimeframe
): MarketBar[] {
  const buckets = new Map<number, Omit<MarketBar, "index">>();

  for (const bar of bars) {
    const barSeconds = Math.floor(Date.parse(bar.time) / 1000);
    if (!Number.isFinite(barSeconds)) continue;
    const bucketSeconds = floorToTimeframeSeconds(barSeconds, timeframe);
    const current = buckets.get(bucketSeconds);
    if (!current) {
      buckets.set(bucketSeconds, {
        time: new Date(bucketSeconds * 1000).toISOString(),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume ?? 0
      });
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume = (current.volume ?? 0) + (bar.volume ?? 0);
  }

  return [...buckets.values()]
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
    .map((bar, index) => ({ ...bar, index }));
}

function yahooChartSymbol(asset: NonNullable<ReturnType<typeof assetForSymbol>>): string | null {
  if (asset.market === "futures") {
    const root = asset.symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const parentRoot: Record<string, string> = {
      M2K: "RTY",
      MBT: "BTC",
      MCL: "CL",
      MES: "ES",
      MET: "ETH",
      MGC: "GC",
      MHG: "HG",
      MNQ: "NQ",
      MNG: "NG",
      MYM: "YM",
      SIL: "SI"
    };
    return root ? `${parentRoot[root] ?? root}=F` : null;
  }
  if (asset.market !== "forex" && asset.market !== "gold_spot") return null;

  const compactSymbol = asset.symbol.replace(/[^A-Z]/gi, "").toUpperCase();
  return compactSymbol.length === 6 ? `${compactSymbol}=X` : null;
}

async function fetchYahooChartBars(
  asset: NonNullable<ReturnType<typeof assetForSymbol>>,
  startSeconds: number,
  endSeconds: number,
  sourceTimeframe: "1m" | "5m" = "5m"
): Promise<Array<{ time: string; open: number; high: number; low: number; close: number; volume?: number }>> {
  const symbol = yahooChartSymbol(asset);
  if (!symbol) return [];

  const period1 = Math.max(0, Math.floor(startSeconds));
  const period2 = Math.max(period1 + 60, Math.min(Math.floor(Date.now() / 1000) + 300, Math.floor(endSeconds) + 300));
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("interval", sourceTimeframe);
  url.searchParams.set("includePrePost", "true");
  url.searchParams.set("events", "div,splits");

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) throw new Error(`Yahoo Finance chart request failed (${response.status})`);

  const payload = await response.json() as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp?.length || !quote) return [];

  const bars: Array<{ time: string; open: number; high: number; low: number; close: number; volume?: number }> = [];
  for (let index = 0; index < result.timestamp.length; index += 1) {
    const timestamp = result.timestamp[index];
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];
    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) continue;

    bars.push({
      time: new Date(timestamp! * 1000).toISOString(),
      open: open!,
      high: high!,
      low: low!,
      close: close!,
      volume: Number.isFinite(volume) ? volume! : undefined
    });
  }

  return bars;
}

async function recentProviderBars({
  asset,
  context,
  entryTime,
  exitTime,
  isOpen,
  requestedTimeframe
}: {
  asset: NonNullable<ReturnType<typeof assetForSymbol>>;
  context: number;
  entryTime: string | null;
  exitTime: string | null;
  isOpen: boolean;
  requestedTimeframe: string;
}): Promise<{ bars: MarketBar[]; timeframe: DataTimeframe; replayBars?: MarketBar[]; replayTimeframe?: DataTimeframe } | null> {
  const entrySeconds = secondsFromSearchTime(entryTime);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exitSeconds = isOpen ? nowSeconds : secondsFromSearchTime(exitTime);
  if (entrySeconds == null || exitSeconds == null) return null;

  const tradeStart = Math.min(entrySeconds, exitSeconds);
  const tradeEnd = Math.max(entrySeconds, exitSeconds);
  if (tradeEnd < nowSeconds - LIVE_FALLBACK_MAX_AGE_SECONDS || tradeStart > nowSeconds + 24 * 60 * 60) return null;

  const sourceTimeframe: "1m" | "5m" = requestedTimeframe === "1m" ? "1m" : "5m";
  const resolvedTimeframe = requestedTimeframe === "1m"
    ? "1m"
    : isDataTimeframe(requestedTimeframe) && timeframeSeconds(requestedTimeframe) >= timeframeSeconds(LIVE_SOURCE_TIMEFRAME)
      ? requestedTimeframe
      : LIVE_SOURCE_TIMEFRAME;
  const requestedContextSeconds = context * timeframeSeconds(resolvedTimeframe);
  const contextSeconds = Math.min(7 * 24 * 60 * 60, Math.max(3 * 60 * 60, requestedContextSeconds));
  const windowStart = Math.max(nowSeconds - LIVE_FALLBACK_MAX_AGE_SECONDS, tradeStart - contextSeconds);
  const windowEnd = isOpen
    ? nowSeconds + timeframeSeconds(sourceTimeframe)
    : tradeEnd + contextSeconds;
  const providerStart = windowStart - timeframeSeconds(sourceTimeframe);
  let sourceBars: Array<{ time: string; open: number; high: number; low: number; close: number; volume?: number }> = [];
  let primaryProviderError: unknown;
  if (sourceTimeframe === "1m" && asset.market === "futures") {
    try {
      sourceBars = (await fetchProjectXMarketDataBars(asset, {
        endSeconds: windowEnd,
        limit: 20_000,
        startSeconds: providerStart,
        unit: 2,
        unitNumber: 1
      })).map((bar) => ({
        close: bar.close,
        high: bar.high,
        low: bar.low,
        open: bar.open,
        time: new Date(bar.time * 1000).toISOString(),
        volume: bar.volume
      }));
    } catch (error) {
      primaryProviderError = error;
    }
  } else if (sourceTimeframe === LIVE_SOURCE_TIMEFRAME && Date.now() >= primaryProviderUnavailableUntil) {
    try {
      sourceBars = await fetchMarketSourceBars(asset, { afterSeconds: providerStart });
    } catch (error) {
      primaryProviderError = error;
      primaryProviderUnavailableUntil = Date.now() + PRIMARY_PROVIDER_COOLDOWN_MS;
    }
  }
  if (!sourceBars.length) {
    try {
      sourceBars = await fetchYahooChartBars(asset, providerStart, windowEnd, sourceTimeframe);
    } catch (fallbackError) {
      if (primaryProviderError) throw primaryProviderError;
      throw fallbackError;
    }
  }
  const sourceWindow = sourceBars.filter((bar) => {
    const seconds = Math.floor(Date.parse(bar.time) / 1000);
    return Number.isFinite(seconds) && seconds >= windowStart && seconds <= windowEnd;
  });
  if (!sourceWindow.length) return null;

  const replayBars = aggregateProviderBars(sourceWindow, sourceTimeframe);
  const bars = resolvedTimeframe === sourceTimeframe
    ? replayBars
    : aggregateProviderBars(sourceWindow, resolvedTimeframe);
  if (!bars.length) return null;

  return {
    bars,
    replayBars: resolvedTimeframe === sourceTimeframe ? undefined : replayBars,
    replayTimeframe: resolvedTimeframe === sourceTimeframe ? undefined : sourceTimeframe,
    timeframe: resolvedTimeframe
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") ?? "";
  const market = searchParams.get("market") ?? "";
  const entryIndex = Math.max(0, Math.round(numericParam(searchParams.get("entryIndex"), 0)));
  const exitIndex = Math.max(0, Math.round(numericParam(searchParams.get("exitIndex"), entryIndex)));
  const context = contextCandles(searchParams.get("context"));
  const timeframe = chartTimeframe(searchParams.get("timeframe"));
  const isOpen = searchParams.get("open") === "1";
  const asset = assetForSymbol(symbol);
  const normalizedMarket = market.trim().toLowerCase();

  if (!asset || (normalizedMarket && isMarket(normalizedMarket) && normalizedMarket !== asset.market)) {
    return NextResponse.json({ bars: [], error: "Missing symbol" }, { status: 400 });
  }

  const candidates = timeframeCandidates(timeframe);
  const localPayloadForCandidate = async (candidate: string) => {
    const filePath = `${candidate}/${asset.dataFile}`;
    try {
      const bars = await barsForTimeframe({
        context,
        entryIndex,
        entryTime: searchParams.get("entryTime"),
        exitIndex,
        exitTime: searchParams.get("exitTime"),
        filePath,
        timeframe: candidate
      });
      if (bars?.length) {
        const replayBars = await replayBarsForTradeWindow({
          assetDataFile: asset.dataFile,
          context,
          entryTime: searchParams.get("entryTime"),
          exitTime: searchParams.get("exitTime"),
          selectedTimeframe: candidate
        });
        return {
          bars,
          fallback: candidate !== timeframe,
          replayBars: replayBars ?? undefined,
          replayTimeframe: replayBars?.length ? "1m" : undefined,
          requestedTimeframe: timeframe,
          timeframe: candidate
        };
      }
    } catch {
      return null;
    }
    return null;
  };

  const providerPayload = async () => {
    const providerResult = await recentProviderBars({
      asset,
      context,
      entryTime: searchParams.get("entryTime"),
      exitTime: searchParams.get("exitTime"),
      isOpen,
      requestedTimeframe: timeframe
    });
    if (providerResult) {
      return {
        bars: providerResult.bars,
        fallback: providerResult.timeframe !== timeframe,
        liveSource: true,
        replayBars: providerResult.replayBars,
        replayTimeframe: providerResult.replayTimeframe,
        requestedTimeframe: timeframe,
        timeframe: providerResult.timeframe
      };
    }
    return null;
  };

  if (isOpen) {
    try {
      const livePayload = await providerPayload();
      if (livePayload) {
        return NextResponse.json(livePayload, {
          headers: { "Cache-Control": "no-store, max-age=0" }
        });
      }
    } catch (error) {
      console.warn("Open trade chart live source failed", error instanceof Error ? error.message : error);
    }
  }

  const exactLocalPayload = await localPayloadForCandidate(candidates[0]);
  if (exactLocalPayload) {
    return NextResponse.json(exactLocalPayload, isOpen ? { headers: { "Cache-Control": "no-store, max-age=0" } } : undefined);
  }

  if (!isOpen) {
    try {
      const livePayload = await providerPayload();
      if (livePayload) return NextResponse.json(livePayload);
    } catch (error) {
      console.warn("Trade chart live fallback failed", error instanceof Error ? error.message : error);
    }
  }

  for (const candidate of candidates.slice(1)) {
    const fallbackPayload = await localPayloadForCandidate(candidate);
    if (fallbackPayload) return NextResponse.json(fallbackPayload);
  }

  return NextResponse.json({
    bars: [],
    error: "No chart data covers this trade.",
    requestedTimeframe: timeframe,
    timeframe
  });
}
