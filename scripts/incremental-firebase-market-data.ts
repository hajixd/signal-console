import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assetsJson from "../config/assets.json";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath } from "../src/lib/firebase-admin";
import { defaultDatasetStatus, getDatasetStatus, saveDatasetStatus, type DatasetAssetCoverage } from "../src/lib/live-config";

type Market = "futures" | "forex" | "gold_spot" | "crypto";

type AssetDefinition = {
  databentoSymbol?: string;
  dataFile: string;
  key: string;
  market: Market;
  name: string;
  symbol: string;
  twelveDataSymbol?: string;
};

type Bar = {
  close: number;
  high: number;
  low: number;
  open: number;
  time: number;
  volume: number;
};

type RemoteCsvState = {
  endsWithNewline: boolean;
  exists: boolean;
  firstBarTime?: number;
  generation?: number;
  lastBarTime?: number;
  size: number;
};

type CliOptions = {
  assetKeys?: Set<string>;
  dryRun: boolean;
  maxAssets?: number;
  missingLookbackDays: number;
  tailBytes: number;
};

type AssetSyncSummary = {
  assetKey: string;
  errors: string[];
  fetchedRows: number;
  provider: "databento" | "twelvedata";
  requestedEnd?: string;
  requestedStart?: string;
  symbol: string;
  uploads: Record<string, { lastBarAt?: string; rows: number; wrote: boolean }>;
};

const DATA_TIMEFRAMES = ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"] as const;
const ONE_MINUTE_DERIVED_TIMEFRAMES = ["5m"] as const;
const INTERVAL_SECONDS: Record<(typeof DATA_TIMEFRAMES)[number], number> = {
  "1m": 60,
  "5m": 5 * 60,
  "15m": 15 * 60,
  "30m": 30 * 60,
  "45m": 45 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60
};

const DATABENTO_CHUNK_DAYS = 3;
const DATABENTO_DATASET = "GLBX.MDP3";
const DATABENTO_SCHEMA = "ohlcv-1m";
const DEFAULT_MISSING_LOOKBACK_DAYS = 30;
const DEFAULT_TAIL_BYTES = 64 * 1024;
const TWELVE_CHUNK_DAYS = 3;

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 60_000
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    return {
      response,
      text: await response.text()
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithRetries(
  url: string,
  init: RequestInit = {},
  timeoutMs = 60_000,
  attempts = 2
): Promise<{ response: Response; text: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchTextWithTimeout(url, init, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
      }
    }
  }
  throw lastError;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    missingLookbackDays: DEFAULT_MISSING_LOOKBACK_DAYS,
    tailBytes: DEFAULT_TAIL_BYTES
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith("--assets=")) {
      options.assetKeys = new Set(
        arg
          .slice("--assets=".length)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      );
      continue;
    }

    if (arg.startsWith("--max-assets=")) {
      const parsed = Number(arg.slice("--max-assets=".length));
      if (Number.isInteger(parsed) && parsed > 0) options.maxAssets = parsed;
      continue;
    }

    if (arg.startsWith("--missing-lookback-days=")) {
      const parsed = Number(arg.slice("--missing-lookback-days=".length));
      if (Number.isFinite(parsed) && parsed > 0) options.missingLookbackDays = Math.floor(parsed);
      continue;
    }

    if (arg.startsWith("--tail-bytes=")) {
      const parsed = Number(arg.slice("--tail-bytes=".length));
      if (Number.isInteger(parsed) && parsed > 0) options.tailBytes = parsed;
    }
  }

  return options;
}

function loadAssets(options: CliOptions): AssetDefinition[] {
  const assets = Object.entries(assetsJson as Record<string, Omit<AssetDefinition, "key">>)
    .map(([key, asset]) => ({ key, ...asset }))
    .filter((asset) => !options.assetKeys || options.assetKeys.has(asset.key) || options.assetKeys.has(asset.symbol));

  if (!assets.length) {
    throw new Error("No assets matched the requested filter.");
  }

  return typeof options.maxAssets === "number" ? assets.slice(0, options.maxAssets) : assets;
}

function addDays(seconds: number, days: number): number {
  return seconds + days * 24 * 60 * 60;
}

function closedBucketStart(intervalSeconds: number): number {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.floor(nowSeconds / intervalSeconds) * intervalSeconds - intervalSeconds;
}

function formatTwelveDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function isoFromSeconds(seconds: number | undefined): string | undefined {
  return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined;
}

function secondsFromIso(value: string | undefined): number | undefined {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
}

function normalizeDatabentoPrice(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number.NaN;
  return Math.abs(numeric) > 1_000_000 ? numeric / 1_000_000_000 : numeric;
}

function parseCsvBarLine(line: string): Bar | null {
  const [timeValue, openValue, highValue, lowValue, closeValue, volumeValue] = line.trim().split(",");
  const time = Number(timeValue);
  const open = Number(openValue);
  const high = Number(highValue);
  const low = Number(lowValue);
  const close = Number(closeValue);
  const volume = Number(volumeValue ?? 0);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  return {
    close,
    high,
    low,
    open,
    time,
    volume: Number.isFinite(volume) ? volume : 0
  };
}

function firstDataTimestamp(text: string): number | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("time,")) continue;
    const bar = parseCsvBarLine(line);
    if (bar) return bar.time;
  }
  return undefined;
}

function lastDataTimestamp(text: string): number | undefined {
  const lines = text.trimEnd().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line || line.startsWith("time,")) continue;
    const bar = parseCsvBarLine(line);
    if (bar) return bar.time;
  }
  return undefined;
}

async function remoteCsvState(relativePath: string, options: CliOptions, includeHead = false): Promise<RemoteCsvState> {
  const file = firebaseBucket().file(storageObjectPath(relativePath));

  try {
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    if (!Number.isFinite(size) || size <= 0) {
      return { endsWithNewline: true, exists: false, size: 0 };
    }

    const tailSize = Math.min(size, options.tailBytes);
    const [tail] = await file.download({
      start: Math.max(0, size - tailSize),
      validation: false
    });
    const tailText = tail.toString("utf8");
    let firstBarTime: number | undefined;

    if (includeHead) {
      const headSize = Math.min(size, options.tailBytes);
      const [head] = await file.download({
        end: headSize - 1,
        start: 0,
        validation: false
      });
      firstBarTime = firstDataTimestamp(head.toString("utf8"));
    }

    return {
      endsWithNewline: tailText.endsWith("\n"),
      exists: true,
      firstBarTime,
      generation: Number.isFinite(Number(metadata.generation)) ? Number(metadata.generation) : undefined,
      lastBarTime: lastDataTimestamp(tailText),
      size
    };
  } catch {
    return { endsWithNewline: true, exists: false, size: 0 };
  }
}

function barsToCsvRows(bars: Bar[]): string {
  return bars
    .map((bar) => `${bar.time},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}`)
    .join("\n");
}

async function appendRemoteText(relativePath: string, text: string, existing: RemoteCsvState): Promise<void> {
  if (!existing.exists) {
    await firebaseBucket().file(storageObjectPath(relativePath)).save(text, {
      contentType: "text/csv; charset=utf-8",
      metadata: {
        cacheControl: "private, max-age=0, no-transform"
      },
      resumable: false
    });
    return;
  }

  const bucket = firebaseBucket();
  const destinationPath = storageObjectPath(relativePath);
  const safePath = relativePath.replace(/[^0-9A-Za-z._/-]/g, "_").replace(/\//g, "_");
  const tempPrefix = storageObjectPath(`tmp/incremental-market-data/${Date.now()}-${process.pid}-${safePath}`);
  const appendObject = bucket.file(`${tempPrefix}-append`);
  const combinedObject = bucket.file(`${tempPrefix}-combined`);

  await appendObject.save(text, {
    contentType: "text/csv; charset=utf-8",
    metadata: {
      cacheControl: "private, max-age=0, no-transform"
    },
    resumable: false
  });

  try {
    await bucket.combine([bucket.file(destinationPath), appendObject], combinedObject);
    await combinedObject.copy(bucket.file(destinationPath), {
      cacheControl: "private, max-age=0, no-transform",
      contentType: "text/csv; charset=utf-8",
      ...(existing.generation ? { preconditionOpts: { ifGenerationMatch: existing.generation } } : {})
    });
  } finally {
    await Promise.allSettled([appendObject.delete(), combinedObject.delete()]);
  }
}

async function writeCsvRows(
  relativePath: string,
  bars: Bar[],
  existing: RemoteCsvState,
  options: CliOptions
): Promise<{ lastBarAt?: string; rows: number; wrote: boolean }> {
  const rows = bars.filter((bar) => existing.lastBarTime == null || bar.time > existing.lastBarTime);
  if (!rows.length) {
    return { lastBarAt: isoFromSeconds(existing.lastBarTime), rows: 0, wrote: false };
  }

  const prefix = existing.exists ? (existing.endsWithNewline ? "" : "\n") : "time,open,high,low,close,volume\n";
  const text = `${prefix}${barsToCsvRows(rows)}\n`;

  if (!options.dryRun) {
    await appendRemoteText(relativePath, text, existing);
  }

  return {
    lastBarAt: isoFromSeconds(rows.at(-1)?.time),
    rows: rows.length,
    wrote: !options.dryRun
  };
}

function uniqueSortedBars(bars: Bar[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const bar of bars) {
    if (!Number.isFinite(bar.time)) continue;
    byTime.set(bar.time, bar);
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

function aggregateBars(sourceBars: Bar[], intervalSeconds: number, afterTime: number | undefined): Bar[] {
  const closedStart = closedBucketStart(intervalSeconds);
  const buckets = new Map<number, Bar>();

  for (const bar of uniqueSortedBars(sourceBars)) {
    const bucketTime = Math.floor(bar.time / intervalSeconds) * intervalSeconds;
    if (bucketTime > closedStart) continue;
    if (afterTime != null && bucketTime <= afterTime) continue;

    const current = buckets.get(bucketTime);
    if (!current) {
      buckets.set(bucketTime, {
        close: bar.close,
        high: bar.high,
        low: bar.low,
        open: bar.open,
        time: bucketTime,
        volume: bar.volume
      });
      continue;
    }

    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
  }

  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

function parseDatabentoCsvBars(text: string, closedStartSeconds: number): Bar[] {
  const bars: Bar[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;

    const columns = line.split(",");
    if (columns.length < 9) continue;

    const time = Math.floor(Number(columns[0]) / 1_000_000_000);
    const open = normalizeDatabentoPrice(columns[4] ?? "");
    const high = normalizeDatabentoPrice(columns[5] ?? "");
    const low = normalizeDatabentoPrice(columns[6] ?? "");
    const close = normalizeDatabentoPrice(columns[7] ?? "");
    const volume = Number(columns[8] ?? 0);
    if (!Number.isFinite(time) || time > closedStartSeconds) continue;
    if ([open, high, low, close, volume].some((value) => !Number.isFinite(value))) continue;
    bars.push({ close, high, low, open, time, volume });
  }
  return bars;
}

async function requestDatabentoCsv(asset: AssetDefinition, startSeconds: number, endSeconds: number): Promise<string> {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) throw new Error("Missing DATABENTO_API_KEY");
  if (!asset.databentoSymbol) throw new Error(`Missing Databento symbol for ${asset.symbol}`);

  const params = new URLSearchParams({
    dataset: DATABENTO_DATASET,
    encoding: "csv",
    end: isoFromSeconds(endSeconds) ?? "",
    schema: DATABENTO_SCHEMA,
    start: isoFromSeconds(startSeconds) ?? "",
    stype_in: "continuous",
    symbols: asset.databentoSymbol
  });
  const { response, text } = await fetchTextWithRetries(
    `https://hist.databento.com/v0/timeseries.get_range?${params.toString()}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
      }
    },
    60_000,
    2
  );
  if (response.ok) return text;

  if (response.status === 422) {
    let parsed: { detail?: { payload?: { available_end?: string } } } | null = null;
    try {
      parsed = JSON.parse(text) as { detail?: { payload?: { available_end?: string } } };
    } catch {
      parsed = null;
    }
    const availableEnd = parsed?.detail?.payload?.available_end;
    if (availableEnd) throw new Error(`DATABENTO_AVAILABLE_END:${availableEnd}`);
  }

  throw new Error(`Databento ${response.status}: ${text.slice(0, 240)}`);
}

async function fetchDatabentoBars(asset: AssetDefinition, startSeconds: number, endSeconds: number): Promise<Bar[]> {
  const bars: Bar[] = [];
  let cursor = startSeconds;
  let effectiveEnd = endSeconds;

  while (cursor <= effectiveEnd) {
    const chunkEndExclusive = Math.min(addDays(cursor, DATABENTO_CHUNK_DAYS), effectiveEnd + 60);
    let text: string;
    try {
      text = await requestDatabentoCsv(asset, cursor, chunkEndExclusive);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith("DATABENTO_AVAILABLE_END:")) throw error;
      const availableSeconds = Math.floor(Date.parse(message.slice("DATABENTO_AVAILABLE_END:".length)) / 1000);
      if (!Number.isFinite(availableSeconds) || availableSeconds < cursor) break;
      effectiveEnd = Math.min(effectiveEnd, availableSeconds - 60);
      continue;
    }

    const chunkBars = parseDatabentoCsvBars(text, effectiveEnd);
    bars.push(...chunkBars);
    console.log(
      `[${asset.symbol}] Databento chunk ${isoFromSeconds(cursor)} to ${isoFromSeconds(chunkEndExclusive)} rows=${chunkBars.length}`
    );
    if (chunkEndExclusive <= cursor) break;
    cursor = chunkEndExclusive;
  }

  return uniqueSortedBars(bars);
}

type TwelveDataResponse = {
  code?: number;
  message?: string;
  status?: string;
  values?: Array<{
    close?: string;
    datetime?: string;
    high?: string;
    low?: string;
    open?: string;
    volume?: string;
  }>;
};

class TwelveDataKeyPool {
  private readonly availableAt = new Map<number, number>();
  private cursor = 0;

  constructor(private readonly keys: string[]) {
    keys.forEach((_, index) => this.availableAt.set(index, 0));
  }

  private nextMinuteBoundary(): number {
    return Math.ceil(Date.now() / 60_000) * 60_000 + 1_000;
  }

  markRateLimited(index: number): void {
    this.availableAt.set(index, this.nextMinuteBoundary());
  }

  async acquire(): Promise<{ index: number; key: string }> {
    while (true) {
      const now = Date.now();
      for (let offset = 0; offset < this.keys.length; offset += 1) {
        const index = (this.cursor + offset) % this.keys.length;
        const readyAt = this.availableAt.get(index) ?? 0;
        if (readyAt <= now) {
          this.cursor = (index + 1) % this.keys.length;
          return { index, key: this.keys[index]! };
        }
      }

      const waitUntil = Math.min(...this.availableAt.values());
      const waitMs = Math.max(1_000, waitUntil - now);
      console.log(`All TwelveData keys are cooling down. Waiting ${Math.ceil(waitMs / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

function parseTwelveBars(values: TwelveDataResponse["values"], closedStartSeconds: number): Bar[] {
  if (!values?.length) return [];

  return values
    .map((value) => {
      if (!value.datetime) return null;
      const time = Math.floor(Date.parse(`${value.datetime}Z`) / 1000);
      const open = Number(value.open);
      const high = Number(value.high);
      const low = Number(value.low);
      const close = Number(value.close);
      const volume = Number(value.volume ?? 0);
      if (!Number.isFinite(time) || time > closedStartSeconds) return null;
      if ([open, high, low, close, volume].some((item) => !Number.isFinite(item))) return null;
      return { close, high, low, open, time, volume };
    })
    .filter((bar): bar is Bar => Boolean(bar));
}

async function fetchTwelveChunk(
  keyPool: TwelveDataKeyPool,
  symbol: string,
  startSeconds: number,
  endSeconds: number
): Promise<Bar[]> {
  const closedStartSeconds = closedBucketStart(60);

  while (true) {
    const { index, key } = await keyPool.acquire();
    const params = new URLSearchParams({
      apikey: key,
      end_date: formatTwelveDate(endSeconds),
      interval: "1min",
      order: "ASC",
      outputsize: "5000",
      start_date: formatTwelveDate(startSeconds),
      symbol,
      timezone: "UTC"
    });
    const { response, text } = await fetchTextWithRetries(`https://api.twelvedata.com/time_series?${params.toString()}`, {}, 45_000, 2);
    const raw = JSON.parse(text) as TwelveDataResponse;
    const limited = raw.code === 429 || /run out of API credits/i.test(raw.message ?? "");
    if (limited) {
      keyPool.markRateLimited(index);
      continue;
    }

    if (/No data is available on the specified dates/i.test(raw.message ?? "")) {
      return [];
    }

    if (!response.ok || (raw.status && raw.status !== "ok")) {
      throw new Error(`TwelveData ${response.status}: ${raw.message ?? raw.status ?? "Unknown error"}`);
    }

    return parseTwelveBars(raw.values, closedStartSeconds);
  }
}

async function fetchTwelveBars(
  keyPool: TwelveDataKeyPool,
  asset: AssetDefinition,
  startSeconds: number,
  endSeconds: number
): Promise<Bar[]> {
  const bars: Bar[] = [];
  const symbol = asset.twelveDataSymbol ?? asset.symbol;
  let cursor = startSeconds;

  while (cursor <= endSeconds) {
    const chunkEnd = Math.min(endSeconds, addDays(cursor, TWELVE_CHUNK_DAYS) - 60);
    bars.push(...(await fetchTwelveChunk(keyPool, symbol, cursor, chunkEnd)));
    cursor = chunkEnd + 60;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return uniqueSortedBars(bars);
}

async function fetchSourceBars(
  keyPool: TwelveDataKeyPool,
  asset: AssetDefinition,
  startSeconds: number,
  endSeconds: number
): Promise<Bar[]> {
  if (asset.market === "futures") return fetchDatabentoBars(asset, startSeconds, endSeconds);
  return fetchTwelveBars(keyPool, asset, startSeconds, endSeconds);
}

function lowerBoundStart(
  asset: AssetDefinition,
  states: Record<(typeof DATA_TIMEFRAMES)[number], RemoteCsvState>,
  existingCoverage: DatasetAssetCoverage | undefined,
  options: CliOptions
): number {
  const latestAllowedMissingStart = closedBucketStart(60) - options.missingLookbackDays * 24 * 60 * 60;
  const knownFirst = states["15m"].firstBarTime ?? secondsFromIso(existingCoverage?.firstBarAt);
  const missingStart = Math.max(knownFirst ?? latestAllowedMissingStart, latestAllowedMissingStart);
  const candidates: number[] = [];

  if (states["1m"].exists && states["1m"].lastBarTime != null) {
    candidates.push(states["1m"].lastBarTime + 60);
  } else {
    candidates.push(missingStart);
  }

  for (const timeframe of ONE_MINUTE_DERIVED_TIMEFRAMES) {
    const state = states[timeframe];
    if (!state.exists || state.lastBarTime == null) {
      candidates.push(missingStart);
      continue;
    }
    const interval = INTERVAL_SECONDS[timeframe];
    if (state.lastBarTime < closedBucketStart(interval)) {
      candidates.push(state.lastBarTime + interval);
    }
  }

  const start = Math.min(...candidates.filter((value) => Number.isFinite(value)));
  if (!Number.isFinite(start)) {
    throw new Error(`Could not determine provider start for ${asset.key}`);
  }
  return Math.max(0, Math.floor(start / 60) * 60);
}

async function readAssetStates(asset: AssetDefinition, options: CliOptions): Promise<Record<(typeof DATA_TIMEFRAMES)[number], RemoteCsvState>> {
  const entries = await Promise.all(
    DATA_TIMEFRAMES.map(async (timeframe) => {
      const includeHead = timeframe === "15m";
      return [timeframe, await remoteCsvState(`data/${timeframe}/${asset.dataFile}`, options, includeHead)] as const;
    })
  );
  return Object.fromEntries(entries) as Record<(typeof DATA_TIMEFRAMES)[number], RemoteCsvState>;
}

async function syncAsset(
  asset: AssetDefinition,
  existingCoverage: DatasetAssetCoverage | undefined,
  keyPool: TwelveDataKeyPool,
  options: CliOptions
): Promise<AssetSyncSummary> {
  const states = await readAssetStates(asset, options);
  const startSeconds = lowerBoundStart(asset, states, existingCoverage, options);
  const endSeconds = closedBucketStart(60);
  const provider = asset.market === "futures" ? "databento" : "twelvedata";
  const summary: AssetSyncSummary = {
    assetKey: asset.key,
    errors: [],
    fetchedRows: 0,
    provider,
    requestedEnd: isoFromSeconds(endSeconds),
    requestedStart: isoFromSeconds(startSeconds),
    symbol: asset.symbol,
    uploads: {}
  };

  if (startSeconds > endSeconds) {
    console.log(`[${asset.symbol}] already current through ${isoFromSeconds(states["1m"].lastBarTime) ?? "unknown"}`);
    return summary;
  }

  console.log(`[${asset.symbol}] fetching ${provider} 1m from ${isoFromSeconds(startSeconds)} to ${isoFromSeconds(endSeconds)}`);
  let sourceBars: Bar[] = [];
  try {
    sourceBars = await fetchSourceBars(keyPool, asset, startSeconds, endSeconds);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.errors.push(message);
    return summary;
  }

  summary.fetchedRows = sourceBars.length;
  if (!sourceBars.length) {
    console.log(`[${asset.symbol}] no provider rows returned`);
    return summary;
  }

  summary.uploads["1m"] = await writeCsvRows(`data/1m/${asset.dataFile}`, sourceBars, states["1m"], options);
  for (const timeframe of ONE_MINUTE_DERIVED_TIMEFRAMES) {
    const rows = aggregateBars(sourceBars, INTERVAL_SECONDS[timeframe], states[timeframe].lastBarTime);
    summary.uploads[timeframe] = await writeCsvRows(`data/${timeframe}/${asset.dataFile}`, rows, states[timeframe], options);
  }

  const uploaded = Object.entries(summary.uploads)
    .filter(([, upload]) => upload.rows > 0)
    .map(([timeframe, upload]) => `${timeframe}:${upload.rows}`)
    .join(", ");
  console.log(`[${asset.symbol}] fetched ${sourceBars.length} rows; ${uploaded || "no new remote rows"}`);

  return summary;
}

function mergeCoverage(
  existing: DatasetAssetCoverage | undefined,
  asset: AssetDefinition,
  summary: AssetSyncSummary,
  refreshedAt: string
): DatasetAssetCoverage {
  const fifteenMinuteRows = summary.uploads["15m"]?.rows ?? 0;
  const lastBarAt = summary.uploads["15m"]?.lastBarAt ?? existing?.lastBarAt;
  const rows = (existing?.rows ?? 0) + fifteenMinuteRows;
  const timeframes = new Set([...(existing?.timeframes ?? []), "1m", "5m"]);

  return {
    dataFile: asset.dataFile,
    firstBarAt: existing?.firstBarAt,
    lastBarAt,
    rows,
    symbol: asset.symbol,
    timeframes: [...timeframes],
    updatedAt: refreshedAt
  };
}

async function writeReport(payload: { generatedAt: string; options: CliOptions; summaries: AssetSyncSummary[] }): Promise<string> {
  const reportDir = path.join(process.cwd(), ".local", "incremental-firebase-market-data");
  await mkdir(reportDir, { recursive: true });
  const safeTime = payload.generatedAt.replace(/[:.]/g, "-");
  const reportPath = path.join(reportDir, `sync-${safeTime}.json`);
  const latestPath = path.join(reportDir, "latest.json");
  const serializable = {
    ...payload,
    options: {
      ...payload.options,
      assetKeys: payload.options.assetKeys ? [...payload.options.assetKeys] : undefined
    }
  };
  const text = JSON.stringify(serializable, null, 2);
  await writeFile(reportPath, text, "utf8");
  await writeFile(latestPath, text, "utf8");
  return path.relative(process.cwd(), reportPath).replace(/\\/g, "/");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!hasFirebaseAdmin()) {
    throw new Error("Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or the split FIREBASE_* variables first.");
  }

  const assets = loadAssets(options);
  const twelveKeys = (process.env.TWELVEDATA_API_KEYS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (assets.some((asset) => asset.market !== "futures") && !twelveKeys.length) {
    throw new Error("Missing TWELVEDATA_API_KEYS for non-futures assets.");
  }

  const startedAt = new Date().toISOString();
  const existingStatus = (await getDatasetStatus()) ?? defaultDatasetStatus();
  const existingCoverage = existingStatus.assetCoverage ?? {};
  const keyPool = new TwelveDataKeyPool(twelveKeys);
  const summaries: AssetSyncSummary[] = [];

  for (const asset of assets) {
    summaries.push(await syncAsset(asset, existingCoverage[asset.key], keyPool, options));
  }

  const uploadedFilesCount = summaries.reduce(
    (sum, summary) => sum + Object.values(summary.uploads).filter((upload) => upload.rows > 0 && !options.dryRun).length,
    0
  );
  const refreshedAt = new Date().toISOString();

  if (!options.dryRun) {
    const assetCoverage = { ...existingCoverage };
    for (const asset of assets) {
      const summary = summaries.find((entry) => entry.assetKey === asset.key);
      if (!summary || summary.errors.length) continue;
      assetCoverage[asset.key] = mergeCoverage(existingCoverage[asset.key], asset, summary, refreshedAt);
    }

    await saveDatasetStatus({
      ...existingStatus,
      assetCoverage,
      lastSyncAt: refreshedAt,
      sync: {
        ...(existingStatus.sync ?? {}),
        lastMarketDataSyncAt: refreshedAt,
        marketDataSync: {
          durationMs: Date.parse(refreshedAt) - Date.parse(startedAt),
          finishedAt: refreshedAt,
          startedAt,
          state: summaries.some((summary) => summary.errors.length) ? "failed" : "success"
        }
      },
      uploadedFilesCount,
      updatedAt: refreshedAt
    });
  }

  const reportPath = await writeReport({ generatedAt: refreshedAt, options, summaries });
  const errorCount = summaries.reduce((sum, summary) => sum + summary.errors.length, 0);
  const fetchedRows = summaries.reduce((sum, summary) => sum + summary.fetchedRows, 0);
  const uploadedRows = summaries.reduce(
    (sum, summary) => sum + Object.values(summary.uploads).reduce((inner, upload) => inner + upload.rows, 0),
    0
  );

  console.log(
    JSON.stringify(
      {
        dryRun: options.dryRun,
        errorCount,
        fetchedRows,
        reportPath,
        uploadedFilesCount: options.dryRun ? 0 : uploadedFilesCount,
        uploadedRows
      },
      null,
      2
    )
  );

  if (errorCount) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
