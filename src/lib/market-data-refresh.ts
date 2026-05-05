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

type CsvBar = {
  close: number;
  high: number;
  low: number;
  open: number;
  time: number;
  volume: number;
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
    /* turbopackIgnore: true */ process.cwd(),
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

async function readExistingBars(asset: AssetDefinition): Promise<CsvBar[]> {
  const relativePath = `data/15m/${asset.dataFile}`;
  const remoteOrLocal = await readProjectTextIfExists(relativePath);
  if (remoteOrLocal !== null) return parseCsvBars(remoteOrLocal);

  try {
    return parseCsvBars(await readFile(localProjectPath(relativePath), "utf8"));
  } catch {
    return [];
  }
}

async function persistAssetBars(asset: AssetDefinition, bars: CsvBar[], refreshedAt: string): Promise<MarketDataRefreshAsset> {
  let uploadedFiles = 0;
  await uploadText(`data/15m/${asset.dataFile}`, serializeCsvBars(bars));
  uploadedFiles += 1;

  const timeframes = ["15m"];
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

      const coverage = await persistAssetBars(asset, mergedBars, refreshedAt);
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
