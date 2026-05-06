import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assetForKey, type AssetDefinition } from "@/lib/assets";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath } from "@/lib/firebase-admin";
import { defaultDatasetStatus, getDatasetStatus, saveDatasetStatus, type DatasetAssetCoverage } from "@/lib/live-config";
import { fetchMarketBars } from "@/lib/market-data";
import { readProjectTextIfExists } from "@/lib/project-assets";
import type { Bar, StrategyRule } from "@/lib/types";

const DERIVED_TIMEFRAMES = [
  { label: "30m", seconds: 30 * 60 },
  { label: "45m", seconds: 45 * 60 },
  { label: "1h", seconds: 60 * 60 },
  { label: "4h", seconds: 4 * 60 * 60 },
  { label: "1d", seconds: 24 * 60 * 60 },
  { label: "1w", seconds: 7 * 24 * 60 * 60 }
] as const;

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
  assetKey: string;
  uploadedFiles: number;
};

export type MarketDataRefreshSummary = {
  assets: MarketDataRefreshAsset[];
  errors: Array<{ assetKey: string; message: string; symbol: string }>;
  refreshedAt: string;
  uploadedFiles: number;
};

export type MarketDataRefreshResult = {
  barsByAssetKey: Map<string, Bar[]>;
  summary: MarketDataRefreshSummary;
};

function localProjectPath(relativePath: string): string {
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    ...relativePath.replace(/\\/g, "/").split("/").filter(Boolean)
  );
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
      symbol
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
  const filePath = localProjectPath(relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

async function uploadText(relativePath: string, text: string): Promise<void> {
  await writeLocalText(relativePath, text);
  if (!hasFirebaseAdmin()) return;

  const destination = storageObjectPath(relativePath);
  const md5Hash = createHash("md5").update(text).digest("base64");
  await firebaseBucket().file(destination).save(text, {
    contentType: "text/csv; charset=utf-8",
    metadata: {
      cacheControl: "private, max-age=0, no-transform",
      contentMD5: md5Hash
    },
    resumable: false
  });
}

async function readExistingBars(asset: AssetDefinition, timeframe = "15m"): Promise<CsvBar[]> {
  const relativePath = `data/${timeframe}/${asset.dataFile}`;
  const remoteOrLocal = await readProjectTextIfExists(relativePath);
  if (remoteOrLocal !== null) return parseCsvBars(remoteOrLocal);

  try {
    return parseCsvBars(await readFile(localProjectPath(relativePath), "utf8"));
  } catch {
    return [];
  }
}

async function persistAssetBars(
  asset: AssetDefinition,
  bars: CsvBar[],
  refreshedAt: string,
  smallTimeframes?: {
    fiveMinuteBars: CsvBar[];
    oneMinuteBars: CsvBar[];
  }
): Promise<MarketDataRefreshAsset> {
  let uploadedFiles = 0;
  const timeframes: string[] = [];

  if (smallTimeframes?.oneMinuteBars.length) {
    await uploadText(`data/1m/${asset.dataFile}`, serializeCsvBars(smallTimeframes.oneMinuteBars));
    uploadedFiles += 1;
    timeframes.push("1m");
  }

  if (smallTimeframes?.fiveMinuteBars.length) {
    await uploadText(`data/5m/${asset.dataFile}`, serializeCsvBars(smallTimeframes.fiveMinuteBars));
    uploadedFiles += 1;
    timeframes.push("5m");
  }

  await uploadText(`data/15m/${asset.dataFile}`, serializeCsvBars(bars));
  uploadedFiles += 1;
  timeframes.push("15m");

  for (const timeframe of DERIVED_TIMEFRAMES) {
    const derived = resampleBars(bars, timeframe.seconds);
    await uploadText(`data/${timeframe.label}/${asset.dataFile}`, serializeCsvBars(derived));
    uploadedFiles += 1;
    timeframes.push(timeframe.label);
  }

  return {
    assetKey: asset.key,
    dataFile: asset.dataFile,
    firstBarAt: isoFromSeconds(bars[0]?.time),
    lastBarAt: isoFromSeconds(bars.at(-1)?.time),
    rows: bars.length,
    symbol: asset.symbol,
    timeframes,
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
    const { assetKey, uploadedFiles, ...coverage } = asset;
    void uploadedFiles;
    assetCoverage[assetKey] = coverage;
  }

  await saveDatasetStatus({
    ...existing,
    assetCoverage,
    lastSyncAt: summary.refreshedAt,
    uploadedFilesCount: summary.uploadedFiles,
    updatedAt: summary.refreshedAt
  });
}

function uniqueAssetRules(rules: StrategyRule[]): StrategyRule[] {
  const byAssetKey = new Map<string, StrategyRule>();
  for (const rule of rules) {
    if (!byAssetKey.has(rule.assetKey)) byAssetKey.set(rule.assetKey, rule);
  }
  return [...byAssetKey.values()];
}

export async function refreshMarketDataForRules(rules: StrategyRule[]): Promise<MarketDataRefreshResult> {
  const refreshedAt = new Date().toISOString();
  const summary: MarketDataRefreshSummary = {
    assets: [],
    errors: [],
    refreshedAt,
    uploadedFiles: 0
  };
  const barsByAssetKey = new Map<string, Bar[]>();

  for (const rule of uniqueAssetRules(rules)) {
    const asset = assetForKey(rule.assetKey);
    try {
      const liveBars = await fetchMarketBars(rule);
      barsByAssetKey.set(rule.assetKey, liveBars);

      const existingBars = await readExistingBars(asset);
      const incomingBars = liveBars.map(barFromLiveBar).filter((bar): bar is CsvBar => Boolean(bar));
      const mergedBars = mergeBars(existingBars, incomingBars);
      if (!mergedBars.length) {
        throw new Error("No bars were available to persist.");
      }

      let smallTimeframes: { fiveMinuteBars: CsvBar[]; oneMinuteBars: CsvBar[] } | undefined;
      try {
        const incomingOneMinuteBars = await fetchOneMinuteBars(asset);
        if (incomingOneMinuteBars.length) {
          const existingOneMinuteBars = await readExistingBars(asset, "1m");
          const existingFiveMinuteBars = await readExistingBars(asset, "5m");
          const oneMinuteBars = mergeBars(existingOneMinuteBars, incomingOneMinuteBars);
          const fiveMinuteBars = mergeBars(existingFiveMinuteBars, resampleBars(incomingOneMinuteBars, FIVE_MINUTE_SECONDS));
          smallTimeframes = {
            fiveMinuteBars,
            oneMinuteBars
          };
        }
      } catch (error) {
        summary.errors.push({
          assetKey: asset.key,
          symbol: asset.symbol,
          message: `1m/5m refresh failed; 15m+ still updated: ${
            error instanceof Error ? error.message : "Unknown small-timeframe refresh error"
          }`
        });
      }

      const coverage = await persistAssetBars(asset, mergedBars, refreshedAt, smallTimeframes);
      summary.assets.push(coverage);
      summary.uploadedFiles += coverage.uploadedFiles;
    } catch (error) {
      summary.errors.push({
        assetKey: asset.key,
        symbol: asset.symbol,
        message: error instanceof Error ? error.message : "Unknown market data refresh error"
      });
    }
  }

  if (summary.assets.length) {
    await saveRefreshStatus(summary);
  }

  return {
    barsByAssetKey,
    summary
  };
}
