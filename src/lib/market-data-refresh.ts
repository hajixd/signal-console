import { createHash } from "node:crypto";
import { appendFile, mkdir, open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assetForKey, type AssetDefinition } from "@/lib/assets";
import { firebaseBucket, firebaseLocalFallbackEnabled, hasFirebaseAdmin, storageObjectPath } from "@/lib/firebase-admin";
import { defaultDatasetStatus, getDatasetStatus, saveDatasetStatus, type DatasetAssetCoverage } from "@/lib/live-config";
import { fetchMarketSourceBars } from "@/lib/market-data";
import { r2AppendText, r2Configured, r2GetTailText, r2HeadObject, r2PutText } from "@/lib/r2";
import {
  DEFAULT_STRATEGY_TIMEFRAME,
  DERIVED_FROM_FIVE_MINUTE_TIMEFRAMES,
  LIVE_SOURCE_TIMEFRAME,
  TIMEFRAME_SECONDS,
  closedBarStartSeconds as closedTimeframeBarStartSeconds,
  type DataTimeframe
} from "@/lib/timeframes";
import type { Bar, StrategyRule } from "@/lib/types";

const REFRESH_TIMEFRAMES = [LIVE_SOURCE_TIMEFRAME, ...DERIVED_FROM_FIVE_MINUTE_TIMEFRAMES] as const;

const ONE_MINUTE_SECONDS = 60;
const FIVE_MINUTE_SECONDS = 5 * 60;

type CsvBar = {
  close: number;
  high: number;
  low: number;
  open: number;
  time: number;
  volume: number;
};

type DatabentoRecord = {
  close?: number | string;
  hd?: {
    ts_event?: number | string;
  };
  high?: number | string;
  low?: number | string;
  open?: number | string;
  time?: number | string;
  ts_event?: number | string;
  volume?: number | string;
};

type OandaCandle = {
  complete?: boolean;
  mid?: {
    c?: string;
    h?: string;
    l?: string;
    o?: string;
  };
  time?: string;
  volume?: number;
};

type OandaResponse = {
  candles?: OandaCandle[];
  errorMessage?: string;
};

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

export type MarketDataRefreshAsset = DatasetAssetCoverage & {
  appendedRows: number;
  assetKey: string;
  durationMs: number;
  uploadedFiles: number;
};

export type MarketDataRefreshSummary = {
  assets: MarketDataRefreshAsset[];
  errors: Array<{ assetKey: string; message: string; symbol: string }>;
  refreshedAt: string;
  totalDurationMs: number;
  uploadedFiles: number;
};

export type MarketDataRefreshResult = {
  barsByAssetKey: Map<string, Bar[]>;
  barsByAssetTimeframeKey: Map<string, Bar[]>;
  summary: MarketDataRefreshSummary;
};

export type MarketDataRefreshOptions = {
  allowApiOnlyStorageFallback?: boolean;
  minExistingRows?: number;
  saveStatus?: boolean;
};

const DEFAULT_MARKET_DATA_REFRESH_CONCURRENCY = 4;

function boundedIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function marketDataRefreshConcurrency(): number {
  return boundedIntegerEnv("MARKET_DATA_REFRESH_CONCURRENCY", DEFAULT_MARKET_DATA_REFRESH_CONCURRENCY, 1, 8);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runWorker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => runWorker()));
  return results;
}

function localProjectPath(relativePath: string): string {
  const root = process.env.VERCEL === "1" ? path.join(tmpdir(), "signal-console") : /*turbopackIgnore: true*/ process.cwd();
  return path.join(
    root,
    ...relativePath.replace(/\\/g, "/").split("/").filter(Boolean)
  );
}

function localMarketDataStorageEnabled(): boolean {
  if (process.env.VERCEL !== "1") return true;
  return ["1", "true", "yes", "on"].includes(process.env.MARKET_DATA_ALLOW_EPHEMERAL_VERCEL_STORAGE?.trim().toLowerCase() ?? "");
}

function enabledEnvFlag(name: string): boolean {
  return ["1", "true", "yes", "on"].includes(process.env[name]?.trim().toLowerCase() ?? "");
}

function marketDataRemoteStorageEnabled(): boolean {
  if (r2Configured()) return true;
  if (hasFirebaseAdmin()) return true;
  if (process.env.VERCEL !== "1") return false;
  return !enabledEnvFlag("PROJECT_STORAGE_FORCE_LOCAL") && !enabledEnvFlag("BACKTEST_FORCE_LOCAL");
}

function marketDataStorageUnavailableMessage(relativePath: string): string {
  return [
    "R2 or Firebase Admin/Storage is required for market data sync on Vercel.",
    `Refusing to write ${relativePath} to ephemeral local storage.`,
    "Set R2_BUCKET/R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY or Firebase Admin credentials in Vercel,",
    "and make sure PROJECT_STORAGE_FORCE_LOCAL/BACKTEST_FORCE_LOCAL are not enabled."
  ].join(" ");
}

function requireLocalMarketDataStorage(relativePath: string): void {
  if (localMarketDataStorageEnabled()) return;
  throw new Error(marketDataStorageUnavailableMessage(relativePath));
}

function storageErrorCode(error: unknown): number | string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: number | string; status?: number | string };
  return candidate.code ?? candidate.status;
}

function isStorageNotFoundError(error: unknown): boolean {
  const code = storageErrorCode(error);
  if (code === 404 || code === "404") return true;
  const message = error instanceof Error ? error.message : "";
  return /\b404\b|not found|no such object/i.test(message);
}

function marketDataStorageError(error: unknown, relativePath: string): Error {
  if (
    process.env.VERCEL === "1" &&
    !localMarketDataStorageEnabled() &&
    error instanceof Error &&
    /(Firebase Admin|R2) is not configured/i.test(error.message)
  ) {
    return new Error(marketDataStorageUnavailableMessage(relativePath));
  }
  return error instanceof Error ? error : new Error("Unknown market data storage error");
}

function readableErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function apiOnlyStorageFallbackEnabled(options: MarketDataRefreshOptions): boolean {
  return options.allowApiOnlyStorageFallback !== false;
}

function isMarketDataStorageAccessError(error: unknown): boolean {
  const message = readableErrorMessage(error);
  return /billing account|owning project is disabled|firebase|firestore|storage|bucket|no such object|invalid.*symlink/i.test(message);
}

function emptyCsvState(): StoredCsvState {
  return {
    endsWithNewline: true,
    exists: false,
    rows: 0,
    tailBars: []
  };
}

function emptyTimeframeStates(): Record<(typeof REFRESH_TIMEFRAMES)[number], StoredCsvState> {
  return Object.fromEntries(REFRESH_TIMEFRAMES.map((timeframe) => [timeframe, emptyCsvState()])) as Record<
    (typeof REFRESH_TIMEFRAMES)[number],
    StoredCsvState
  >;
}

function csvNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(12).replace(/\.?0+$/g, "") || "0";
}

function isoFromSeconds(seconds: number | undefined): string | undefined {
  return typeof seconds === "number" && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : undefined;
}

function secondsFromIso(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function secondsFromProviderTime(value: number | string | undefined): number | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return null;
    if (text.length > 16) return Math.floor(numeric / 1_000_000_000);
    if (text.length > 13) return Math.floor(numeric / 1_000_000);
    if (text.length > 10) return Math.floor(numeric / 1_000);
    return Math.floor(numeric);
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function databentoRecordSeconds(record: DatabentoRecord): number | null {
  return (
    secondsFromProviderTime(record.time) ??
    secondsFromProviderTime(record.ts_event) ??
    secondsFromProviderTime(record.hd?.ts_event)
  );
}

function normalizeProviderPrice(value: number | string | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number.NaN;
  return Math.abs(numeric) > 1_000_000 ? numeric / 1_000_000_000 : numeric;
}

function normalizeProviderVolume(value: number | string | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeCsvBar(bar: CsvBar): CsvBar | null {
  if (![bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) return null;
  return {
    time: Math.floor(bar.time),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: Number.isFinite(bar.volume) ? bar.volume : 0
  };
}

function barFromLiveBar(bar: Bar): CsvBar | null {
  const seconds = secondsFromIso(bar.time);
  if (seconds === null) return null;
  return normalizeCsvBar({
    time: seconds,
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume ?? 0)
  });
}

function liveBarFromCsvBar(bar: CsvBar): Bar {
  return {
    time: new Date(bar.time * 1000).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume
  };
}

export function assetTimeframeBarsKey(assetKey: string, timeframe: DataTimeframe): string {
  return `${assetKey}\t${timeframe}`;
}

function closedBarStartSeconds(intervalSeconds: number): number {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.floor(nowSeconds / intervalSeconds) * intervalSeconds - intervalSeconds;
}

function filterClosedBars(bars: CsvBar[], intervalSeconds: number): CsvBar[] {
  const closedStart = closedBarStartSeconds(intervalSeconds);
  return bars.filter((bar) => bar.time <= closedStart);
}

function parseCsvBars(text: string | null): CsvBar[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const bars: CsvBar[] = [];

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [time, open, high, low, close, volume] = trimmed.split(",");
    const bar = normalizeCsvBar({
      time: Number(time),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume ?? 0)
    });
    if (bar) bars.push(bar);
  }

  return bars;
}

function serializeCsvBars(bars: CsvBar[]): string {
  return [
    "time,open,high,low,close,volume",
    ...bars.map((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].map(csvNumber).join(","))
  ].join("\n") + "\n";
}

function mergeBars(existing: CsvBar[], incoming: CsvBar[]): CsvBar[] {
  const byTime = new Map<number, CsvBar>();
  for (const bar of existing) byTime.set(bar.time, bar);
  for (const bar of incoming) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

function timeframeBucket(time: number, seconds: number): number {
  return Math.floor(time / seconds) * seconds;
}

function resampleBars(bars: CsvBar[], seconds: number): CsvBar[] {
  const buckets = new Map<number, CsvBar>();
  for (const bar of bars) {
    const bucket = timeframeBucket(bar.time, seconds);
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { ...bar, time: bucket });
      continue;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
  }
  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

function parseDatabentoMinuteBars(text: string): CsvBar[] {
  const bars: CsvBar[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("{\"symbol_mapping\"")) continue;

    try {
      const record = JSON.parse(trimmed) as DatabentoRecord;
      const time = databentoRecordSeconds(record);
      if (time === null) continue;

      const bar = normalizeCsvBar({
        time,
        open: normalizeProviderPrice(record.open),
        high: normalizeProviderPrice(record.high),
        low: normalizeProviderPrice(record.low),
        close: normalizeProviderPrice(record.close),
        volume: normalizeProviderVolume(record.volume)
      });
      if (bar) bars.push(bar);
    } catch {
      continue;
    }
  }

  return filterClosedBars(bars, ONE_MINUTE_SECONDS).sort((left, right) => left.time - right.time);
}

function parseOandaMinuteBars(candles: OandaCandle[] | undefined): CsvBar[] {
  if (!candles?.length) return [];

  return filterClosedBars(
    candles
      .filter((candle) => candle.complete && candle.time && candle.mid)
      .map((candle) =>
        normalizeCsvBar({
          time: secondsFromIso(candle.time!) ?? Number.NaN,
          open: Number(candle.mid!.o),
          high: Number(candle.mid!.h),
          low: Number(candle.mid!.l),
          close: Number(candle.mid!.c),
          volume: Number(candle.volume ?? 0)
        })
      )
      .filter((bar): bar is CsvBar => Boolean(bar)),
    ONE_MINUTE_SECONDS
  ).sort((left, right) => left.time - right.time);
}

function parseTwelveDataBars(values: TwelveDataResponse["values"], intervalSeconds: number): CsvBar[] {
  if (!values?.length) return [];

  return filterClosedBars(
    values
      .map((value) => {
        if (!value.datetime) return null;
        return normalizeCsvBar({
          time: secondsFromIso(`${value.datetime}Z`) ?? Number.NaN,
          open: Number(value.open),
          high: Number(value.high),
          low: Number(value.low),
          close: Number(value.close),
          volume: Number(value.volume ?? 0)
        });
      })
      .filter((bar): bar is CsvBar => Boolean(bar)),
    intervalSeconds
  ).sort((left, right) => left.time - right.time);
}

async function requestDatabentoBars(apiKey: string, params: URLSearchParams): Promise<Response> {
  return fetch(`https://hist.databento.com/v0/timeseries.get_range?${params.toString()}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
    },
    cache: "no-store"
  });
}

async function fetchDatabentoOneMinuteBars(asset: AssetDefinition): Promise<CsvBar[]> {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) throw new Error("Missing DATABENTO_API_KEY");
  if (!asset.databentoSymbol) throw new Error(`Missing Databento symbol for ${asset.symbol}`);

  const start = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000);
  const end = new Date();
  start.setUTCSeconds(0, 0);
  end.setUTCSeconds(0, 0);
  const params = new URLSearchParams({
    dataset: "GLBX.MDP3",
    encoding: "json",
    schema: "ohlcv-1m",
    start: start.toISOString(),
    stype_in: "continuous",
    symbols: asset.databentoSymbol,
    end: end.toISOString()
  });

  let response = await requestDatabentoBars(apiKey, params);
  if (!response.ok) {
    const body = await response.text();
    const availableEndMatch = body.match(/available up to '([^']+)'/);
    if (response.status === 422 && availableEndMatch?.[1]) {
      const retryParams = new URLSearchParams(params);
      retryParams.set("end", new Date(availableEndMatch[1]).toISOString());
      response = await requestDatabentoBars(apiKey, retryParams);
    } else {
      throw new Error(`Databento ${response.status}: ${body.slice(0, 240)}`);
    }
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Databento ${response.status}: ${body.slice(0, 240)}`);
  }

  return parseDatabentoMinuteBars(await response.text());
}

async function fetchOandaOneMinuteBars(instrument: string): Promise<CsvBar[]> {
  const token = process.env.OANDA_API_TOKEN;
  if (!token) throw new Error("Missing OANDA_API_TOKEN");
  const baseUrl = process.env.OANDA_API_BASE_URL ?? "https://api-fxpractice.oanda.com";
  const params = new URLSearchParams({
    count: "1500",
    granularity: "M1",
    price: "M"
  });
  const response = await fetch(`${baseUrl}/v3/instruments/${instrument}/candles?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });
  const data = (await response.json()) as OandaResponse;
  if (!response.ok || !data.candles) throw new Error(data.errorMessage ?? `OANDA ${response.status}`);
  return parseOandaMinuteBars(data.candles);
}

async function fetchTwelveDataTimeframeBars(symbol: string, interval: "1min" | "5min"): Promise<CsvBar[]> {
  const keys = (process.env.TWELVEDATA_API_KEYS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!keys.length) throw new Error("Missing TWELVEDATA_API_KEYS");
  const startIndex = Math.floor(Date.now() / 60_000) % keys.length;
  const orderedKeys = keys.map((_, index) => keys[(startIndex + index) % keys.length]!);
  const failures: string[] = [];

  for (const apiKey of orderedKeys) {
    const params = new URLSearchParams({
      apikey: apiKey,
      interval,
      order: "ASC",
      outputsize: "5000",
      symbol,
      timezone: "UTC"
    });
    const response = await fetch(`https://api.twelvedata.com/time_series?${params.toString()}`, { cache: "no-store" });
    const raw = await response.text();

    let data: TwelveDataResponse;
    try {
      data = JSON.parse(raw) as TwelveDataResponse;
    } catch {
      failures.push(`...${apiKey.slice(-4)}: invalid JSON response (${response.status})`);
      continue;
    }

    if (response.ok && data.values?.length) {
      return parseTwelveDataBars(data.values, interval === "1min" ? ONE_MINUTE_SECONDS : FIVE_MINUTE_SECONDS);
    }

    const reason = data.message ?? data.status ?? `HTTP ${response.status}`;
    failures.push(`...${apiKey.slice(-4)}: ${reason}`);
  }

  throw new Error(`TwelveData ${interval} failed for all API keys: ${failures.join(" | ")}`);
}

async function fetchOneMinuteBars(asset: AssetDefinition): Promise<CsvBar[]> {
  if (asset.market === "futures") return fetchDatabentoOneMinuteBars(asset);
  if ((asset.market === "forex" || asset.market === "gold_spot") && process.env.OANDA_API_TOKEN) {
    return fetchOandaOneMinuteBars(asset.oandaSymbol ?? asset.symbol);
  }
  return fetchTwelveDataTimeframeBars(asset.twelveDataSymbol ?? asset.symbol, "1min");
}

async function writeLocalText(relativePath: string, text: string): Promise<void> {
  requireLocalMarketDataStorage(relativePath);
  const filePath = localProjectPath(relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

async function appendLocalText(relativePath: string, text: string): Promise<void> {
  requireLocalMarketDataStorage(relativePath);
  const filePath = localProjectPath(relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, text, "utf8");
}

type StoredCsvState = {
  endsWithNewline: boolean;
  exists: boolean;
  firstBarTime?: number;
  generation?: number;
  lastBarTime?: number;
  rows?: number;
  tailBars?: CsvBar[];
};

function csvDataLine(bar: CsvBar): string {
  return [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].map(csvNumber).join(",");
}

function serializeCsvDataLines(bars: CsvBar[]): string {
  return bars.map(csvDataLine).join("\n") + (bars.length ? "\n" : "");
}

function parseCsvBarLine(line: string): CsvBar | null {
  if (!line.trim() || line.startsWith("time,")) return null;
  const [time, open, high, low, close, volume] = line.trim().split(",");
  return normalizeCsvBar({
    time: Number(time),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume ?? 0)
  });
}

function parseCsvTailBars(text: string, limit = 1500): CsvBar[] {
  return text
    .split(/\r?\n/)
    .map(parseCsvBarLine)
    .filter((bar): bar is CsvBar => Boolean(bar))
    .slice(-limit);
}

function firstDataTimestamp(text: string): number | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("time,")) continue;
    const timestamp = Number(trimmed.split(",", 1)[0]);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return undefined;
}

function lastDataTimestamp(text: string): number | undefined {
  const lines = text.trimEnd().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index]?.trim();
    if (!trimmed || trimmed.startsWith("time,")) continue;
    const timestamp = Number(trimmed.split(",", 1)[0]);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return undefined;
}

async function localCsvState(relativePath: string, coverage: DatasetAssetCoverage | undefined): Promise<StoredCsvState> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(localProjectPath(relativePath), "r");
    const stat = await handle.stat();
    if (!stat.size) return { endsWithNewline: true, exists: false, rows: coverage?.rows };

    const headSize = Math.min(4096, stat.size);
    const tailSize = Math.min(65536, stat.size);
    const head = Buffer.alloc(headSize);
    const tail = Buffer.alloc(tailSize);
    await handle.read(head, 0, headSize, 0);
    await handle.read(tail, 0, tailSize, Math.max(0, stat.size - tailSize));
    const tailText = tail.toString("utf8");

    return {
        endsWithNewline: tailText.endsWith("\n"),
        exists: true,
        firstBarTime: secondsFromIso(coverage?.firstBarAt ?? "") ?? firstDataTimestamp(head.toString("utf8")),
        lastBarTime: lastDataTimestamp(tailText),
        rows: coverage?.rows,
        tailBars: parseCsvTailBars(tailText)
      };
  } catch {
    return { endsWithNewline: true, exists: false, rows: coverage?.rows };
  } finally {
    await handle?.close();
  }
}

async function remoteCsvState(relativePath: string, coverage: DatasetAssetCoverage | undefined): Promise<StoredCsvState> {
  if (r2Configured()) {
    try {
      const metadata = await r2HeadObject(relativePath);
      const size = Number(metadata?.contentLength ?? 0);
      if (!Number.isFinite(size) || size <= 0) return { endsWithNewline: true, exists: false, rows: coverage?.rows };

      const tailText = (await r2GetTailText(relativePath, 65536)) ?? "";
      return {
        endsWithNewline: tailText.endsWith("\n"),
        exists: true,
        firstBarTime: secondsFromIso(coverage?.firstBarAt ?? "") ?? undefined,
        lastBarTime: lastDataTimestamp(tailText),
        rows: coverage?.rows,
        tailBars: parseCsvTailBars(tailText)
      };
    } catch (error) {
      if (firebaseLocalFallbackEnabled()) return localCsvState(relativePath, coverage);
      throw marketDataStorageError(error, relativePath);
    }
  }

  try {
    const file = firebaseBucket().file(storageObjectPath(relativePath));
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    if (!Number.isFinite(size) || size <= 0) return { endsWithNewline: true, exists: false, rows: coverage?.rows };

    const [tail] = await file.download({
      start: Math.max(0, size - 65536),
      validation: false
    });
    const tailText = tail.toString("utf8");

    return {
      endsWithNewline: tailText.endsWith("\n"),
      exists: true,
      firstBarTime: secondsFromIso(coverage?.firstBarAt ?? "") ?? undefined,
      generation: Number.isFinite(Number(metadata.generation)) ? Number(metadata.generation) : undefined,
      lastBarTime: lastDataTimestamp(tailText),
      rows: coverage?.rows,
      tailBars: parseCsvTailBars(tailText)
    };
  } catch (error) {
    if (isStorageNotFoundError(error)) return { endsWithNewline: true, exists: false, rows: coverage?.rows };
    if (firebaseLocalFallbackEnabled()) return localCsvState(relativePath, coverage);
    throw marketDataStorageError(error, relativePath);
  }
}

async function storedCsvState(relativePath: string, coverage: DatasetAssetCoverage | undefined): Promise<StoredCsvState> {
  if (marketDataRemoteStorageEnabled()) return remoteCsvState(relativePath, coverage);
  if (!localMarketDataStorageEnabled()) throw new Error(marketDataStorageUnavailableMessage(relativePath));
  return localCsvState(relativePath, coverage);
}

function remoteTempObjectPath(relativePath: string, label: string): string {
  const safePath = relativePath.replace(/[^0-9A-Za-z._/-]/g, "_").replace(/\//g, "_");
  return storageObjectPath(`tmp/market-data-sync/${Date.now()}-${process.pid}-${label}-${safePath}`);
}

async function saveRemoteText(relativePath: string, text: string): Promise<void> {
  if (r2Configured()) {
    await r2PutText(relativePath, text, "text/csv; charset=utf-8");
    return;
  }

  const md5Hash = createHash("md5").update(text).digest("base64");
  await firebaseBucket().file(storageObjectPath(relativePath)).save(text, {
    contentType: "text/csv; charset=utf-8",
    metadata: {
      cacheControl: "private, max-age=0, no-transform",
      contentMD5: md5Hash
    },
    resumable: false
  });
}

async function appendRemoteText(relativePath: string, text: string, existing: StoredCsvState): Promise<void> {
  if (r2Configured()) {
    if (!existing.exists) {
      await r2PutText(relativePath, `time,open,high,low,close,volume\n${text}`, "text/csv; charset=utf-8");
      return;
    }
    await r2AppendText(relativePath, text, "text/csv; charset=utf-8");
    return;
  }

  if (!existing.exists) {
    await saveRemoteText(relativePath, `time,open,high,low,close,volume\n${text}`);
    return;
  }

  const bucket = firebaseBucket();
  const destinationPath = storageObjectPath(relativePath);
  const appendPath = remoteTempObjectPath(relativePath, "append");
  const combinedPath = remoteTempObjectPath(relativePath, "combined");
  const appendObject = bucket.file(appendPath);
  const combinedObject = bucket.file(combinedPath);

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

async function appendStoredCsvRows(relativePath: string, bars: CsvBar[], existing: StoredCsvState): Promise<void> {
  if (!bars.length) return;
  const prefix = existing.exists && !existing.endsWithNewline ? "\n" : "";
  const text = `${prefix}${serializeCsvDataLines(bars)}`;

  if (marketDataRemoteStorageEnabled()) {
    try {
      await appendRemoteText(relativePath, text, existing);
      return;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw marketDataStorageError(error, relativePath);
    }
  }

  if (!existing.exists) {
    await writeLocalText(relativePath, `time,open,high,low,close,volume\n${serializeCsvDataLines(bars)}`);
    return;
  }

  await appendLocalText(relativePath, text);
}

function newBarsAfter(existing: StoredCsvState, incomingBars: CsvBar[]): CsvBar[] {
  const seen = new Set<number>();
  return incomingBars
    .filter((bar) => existing.lastBarTime == null || bar.time > existing.lastBarTime)
    .filter((bar) => {
      if (seen.has(bar.time)) return false;
      seen.add(bar.time);
      return true;
    })
    .sort((left, right) => left.time - right.time);
}

type TimeframeUpload = {
  appendedBars: CsvBar[];
  existing: StoredCsvState;
  timeframe: DataTimeframe;
};

async function readTimeframeStates(
  asset: AssetDefinition,
  coverage: DatasetAssetCoverage | undefined
): Promise<Record<(typeof REFRESH_TIMEFRAMES)[number], StoredCsvState>> {
  const entries = await Promise.all(
    REFRESH_TIMEFRAMES.map(async (timeframe) => {
      const relativePath = `data/${timeframe}/${asset.dataFile}`;
      return [timeframe, await storedCsvState(relativePath, coverage)] as const;
    })
  );
  return Object.fromEntries(entries) as Record<(typeof REFRESH_TIMEFRAMES)[number], StoredCsvState>;
}

function refreshStartAfterSeconds(states: Record<(typeof REFRESH_TIMEFRAMES)[number], StoredCsvState>): number | undefined {
  const candidates = REFRESH_TIMEFRAMES.map((timeframe) => states[timeframe].lastBarTime).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  return candidates.length ? Math.min(...candidates) : undefined;
}

function allTimeframesCurrent(states: Record<(typeof REFRESH_TIMEFRAMES)[number], StoredCsvState>): boolean {
  return REFRESH_TIMEFRAMES.every((timeframe) => {
    const lastBarTime = states[timeframe].lastBarTime;
    return lastBarTime != null && lastBarTime >= closedTimeframeBarStartSeconds(timeframe);
  });
}

function aggregateCsvBarsToTimeframe(sourceBars: CsvBar[], timeframe: DataTimeframe, afterTime: number | undefined): CsvBar[] {
  const closedStart = closedTimeframeBarStartSeconds(timeframe);
  const buckets = new Map<number, CsvBar>();

  for (const bar of sourceBars) {
    const bucketTime = Math.floor(bar.time / TIMEFRAME_SECONDS[timeframe]) * TIMEFRAME_SECONDS[timeframe];
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

function appendedCoverage(
  asset: AssetDefinition,
  existingCoverage: DatasetAssetCoverage | undefined,
  uploads: TimeframeUpload[],
  refreshedAt: string
): Omit<MarketDataRefreshAsset, "durationMs"> {
  const sourceUpload = uploads.find((upload) => upload.timeframe === LIVE_SOURCE_TIMEFRAME) ?? uploads[0];
  const firstBarTime = existingCoverage?.firstBarAt
    ? secondsFromIso(existingCoverage.firstBarAt) ?? undefined
    : sourceUpload?.existing.firstBarTime ?? sourceUpload?.appendedBars[0]?.time;
  const lastBarTime = sourceUpload?.appendedBars.at(-1)?.time ?? sourceUpload?.existing.lastBarTime;
  const appendedRows = uploads.reduce((sum, upload) => sum + upload.appendedBars.length, 0);
  const uploadedFiles = uploads.filter((upload) => upload.appendedBars.length > 0).length;
  const sourceRows = sourceUpload
    ? (sourceUpload.existing.rows ?? existingCoverage?.rows ?? 0) + sourceUpload.appendedBars.length
    : existingCoverage?.rows ?? 0;

  return {
    appendedRows,
    assetKey: asset.key,
    dataFile: asset.dataFile,
    firstBarAt: isoFromSeconds(firstBarTime),
    lastBarAt: isoFromSeconds(lastBarTime),
    rows: sourceRows,
    symbol: asset.symbol,
    timeframes: [...new Set([...(existingCoverage?.timeframes ?? []), ...REFRESH_TIMEFRAMES])],
    updatedAt: refreshedAt,
    uploadedFiles
  };
}

async function saveRefreshStatus(summary: MarketDataRefreshSummary): Promise<void> {
  const existing = (await getDatasetStatus()) ?? defaultDatasetStatus();
  const assetCoverage = {
    ...(existing.assetCoverage ?? {})
  };

  for (const asset of summary.assets) {
    const { appendedRows, assetKey, durationMs, uploadedFiles, ...coverage } = asset;
    void appendedRows;
    void durationMs;
    void uploadedFiles;
    assetCoverage[assetKey] = coverage;
  }

  await saveDatasetStatus({
    ...existing,
    assetCoverage,
    lastSyncAt: summary.refreshedAt,
    sync: {
      ...(existing.sync ?? {}),
      lastMarketDataSyncAt: summary.refreshedAt
    },
    uploadedFilesCount: summary.uploadedFiles,
    updatedAt: summary.refreshedAt
  });
}

export async function saveMarketDataRefreshStatus(summary: MarketDataRefreshSummary): Promise<void> {
  if (summary.assets.length) await saveRefreshStatus(summary);
}

function uniqueAssetRules(rules: StrategyRule[]): StrategyRule[] {
  const byAssetKey = new Map<string, StrategyRule>();
  for (const rule of rules) {
    if (!byAssetKey.has(rule.assetKey)) byAssetKey.set(rule.assetKey, rule);
  }
  return [...byAssetKey.values()];
}

export function marketDataRefreshErrorSummary(summary: Pick<MarketDataRefreshSummary, "errors">): string | undefined {
  if (!summary.errors.length) return undefined;
  const groups = new Map<string, string[]>();
  for (const error of summary.errors) {
    const symbols = groups.get(error.message) ?? [];
    symbols.push(error.symbol);
    groups.set(error.message, symbols);
  }
  return [...groups.entries()]
    .map(([message, symbols]) => {
      const visibleSymbols = symbols.slice(0, 12).join(", ");
      const suffix = symbols.length > 12 ? `, +${symbols.length - 12} more` : "";
      return `${symbols.length} asset${symbols.length === 1 ? "" : "s"} (${visibleSymbols}${suffix}): ${message}`;
    })
    .join("; ");
}

type AssetRefreshOutcome =
  | {
      asset: MarketDataRefreshAsset;
      assetKey: string;
      bars?: Bar[];
      barsByTimeframe?: Partial<Record<DataTimeframe, Bar[]>>;
      error?: never;
    }
  | {
      asset?: never;
      assetKey: string;
      error: { assetKey: string; message: string; symbol: string };
      bars?: never;
      barsByTimeframe?: never;
    };

function barsByTimeframeFromStates(
  states: Record<(typeof REFRESH_TIMEFRAMES)[number], StoredCsvState>,
  uploads: TimeframeUpload[] = []
): Partial<Record<DataTimeframe, Bar[]>> {
  const uploadsByTimeframe = new Map(uploads.map((upload) => [upload.timeframe, upload]));
  const output: Partial<Record<DataTimeframe, Bar[]>> = {};

  for (const timeframe of REFRESH_TIMEFRAMES) {
    const state = states[timeframe];
    const upload = uploadsByTimeframe.get(timeframe);
    const bars = mergeBars(state.tailBars ?? [], upload?.appendedBars ?? []).slice(-1500);
    if (bars.length) output[timeframe] = bars.map(liveBarFromCsvBar);
  }

  return output;
}

export async function refreshMarketDataForRules(rules: StrategyRule[]): Promise<MarketDataRefreshResult> {
  return refreshMarketDataForRulesWithOptions(rules);
}

export async function refreshMarketDataForAssetKeys(
  assetKeys: string[],
  options: MarketDataRefreshOptions = {}
): Promise<MarketDataRefreshResult> {
  const rules = [...new Set(assetKeys)].map((assetKey) => ({ assetKey }) as StrategyRule);
  return refreshMarketDataForRulesWithOptions(rules, options);
}

export async function refreshMarketDataForRulesWithOptions(
  rules: StrategyRule[],
  options: MarketDataRefreshOptions = {}
): Promise<MarketDataRefreshResult> {
  const startedAt = Date.now();
  const refreshedAt = new Date().toISOString();
  const existingStatus = await getDatasetStatus();
  const assetCoverage = existingStatus?.assetCoverage ?? {};
  const summary: MarketDataRefreshSummary = {
    assets: [],
    errors: [],
    refreshedAt,
    totalDurationMs: 0,
    uploadedFiles: 0
  };
  const barsByAssetKey = new Map<string, Bar[]>();
  const barsByAssetTimeframeKey = new Map<string, Bar[]>();

  const outcomes = await mapWithConcurrency(uniqueAssetRules(rules), marketDataRefreshConcurrency(), async (rule): Promise<AssetRefreshOutcome> => {
    const assetStartedAt = Date.now();
    const asset = assetForKey(rule.assetKey);
    try {
      let states: Record<(typeof REFRESH_TIMEFRAMES)[number], StoredCsvState>;
      let storageFallbackReason: string | undefined;
      try {
        states = await readTimeframeStates(asset, assetCoverage[asset.key]);
      } catch (error) {
        if (!apiOnlyStorageFallbackEnabled(options) || !isMarketDataStorageAccessError(error)) throw error;
        storageFallbackReason = readableErrorMessage(error);
        states = emptyTimeframeStates();
      }

      if (allTimeframesCurrent(states)) {
        const coverage = appendedCoverage(asset, assetCoverage[asset.key], [], refreshedAt);
        return {
          asset: {
            ...coverage,
            durationMs: Date.now() - assetStartedAt
          },
          assetKey: asset.key,
          barsByTimeframe: barsByTimeframeFromStates(states)
        };
      }

      const afterSeconds = refreshStartAfterSeconds(states);
      const liveBars = await fetchMarketSourceBars(asset, afterSeconds == null ? {} : { afterSeconds });

      const incomingBars = liveBars.map(barFromLiveBar).filter((bar): bar is CsvBar => Boolean(bar));
      if (!incomingBars.length && !states[LIVE_SOURCE_TIMEFRAME].exists) {
        throw new Error("No bars were available to persist.");
      }

      const uploads: TimeframeUpload[] = [];
      const sourceAppendedBars = newBarsAfter(states[LIVE_SOURCE_TIMEFRAME], incomingBars);
      uploads.push({
        appendedBars: sourceAppendedBars,
        existing: states[LIVE_SOURCE_TIMEFRAME],
        timeframe: LIVE_SOURCE_TIMEFRAME
      });

      for (const timeframe of DERIVED_FROM_FIVE_MINUTE_TIMEFRAMES) {
        const appendedBars = aggregateCsvBarsToTimeframe(incomingBars, timeframe, states[timeframe].lastBarTime);
        uploads.push({
          appendedBars,
          existing: states[timeframe],
          timeframe
        });
      }

      let persistedUploads = true;
      if (storageFallbackReason) {
        persistedUploads = false;
      } else {
        try {
          await Promise.all(
            uploads.map((upload) =>
              upload.appendedBars.length
                ? appendStoredCsvRows(`data/${upload.timeframe}/${asset.dataFile}`, upload.appendedBars, upload.existing)
                : Promise.resolve()
            )
          );
        } catch (error) {
          if (!apiOnlyStorageFallbackEnabled(options) || !isMarketDataStorageAccessError(error)) throw error;
          storageFallbackReason = readableErrorMessage(error);
          persistedUploads = false;
        }
      }
      const coverage = appendedCoverage(asset, assetCoverage[asset.key], uploads, refreshedAt);
      return {
        asset: {
          ...coverage,
          durationMs: Date.now() - assetStartedAt,
          uploadedFiles: persistedUploads ? coverage.uploadedFiles : 0
        },
        assetKey: asset.key,
        barsByTimeframe: barsByTimeframeFromStates(states, uploads),
        bars: liveBars
      };
    } catch (error) {
      return {
        assetKey: asset.key,
        error: {
          assetKey: asset.key,
          symbol: asset.symbol,
          message: error instanceof Error ? error.message : "Unknown market data refresh error"
        }
      };
    }
  });

  for (const outcome of outcomes) {
    if (outcome.error) {
      summary.errors.push(outcome.error);
      continue;
    }
    summary.assets.push(outcome.asset);
    summary.uploadedFiles += outcome.asset.uploadedFiles;
    if (outcome.bars) barsByAssetKey.set(outcome.assetKey, outcome.bars);
    for (const [timeframe, bars] of Object.entries(outcome.barsByTimeframe ?? {}) as Array<[DataTimeframe, Bar[]]>) {
      barsByAssetTimeframeKey.set(assetTimeframeBarsKey(outcome.assetKey, timeframe), bars);
      if (timeframe === DEFAULT_STRATEGY_TIMEFRAME && !barsByAssetKey.has(outcome.assetKey)) {
        barsByAssetKey.set(outcome.assetKey, bars);
      }
    }
  }

  summary.totalDurationMs = Date.now() - startedAt;

  if (options.saveStatus !== false && summary.assets.length) {
    await saveRefreshStatus(summary);
  }

  return {
    barsByAssetKey,
    barsByAssetTimeframeKey,
    summary
  };
}
