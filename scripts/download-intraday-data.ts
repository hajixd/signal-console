import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";

type Market = "futures" | "forex" | "gold_spot";

type AssetDefinition = {
  key: string;
  symbol: string;
  name: string;
  market: Market;
  dataFile: string;
  databentoSymbol?: string;
  twelveDataSymbol?: string;
  oandaSymbol?: string;
};

type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type FileCoverage = {
  path: string;
  rows: number;
  firstTime?: string;
  lastTime?: string;
  complete: boolean;
};

type AssetDownloadSummary = {
  assetKey: string;
  symbol: string;
  market: Market;
  provider: "databento" | "twelvedata";
  requestedStart: string;
  requestedEnd: string;
  files: {
    ["1m"]?: FileCoverage;
    ["5m"]?: FileCoverage;
  };
  notes: string[];
  errors: string[];
};

type CliOptions = {
  assetKeys?: Set<string>;
  fullTwelveOneMinute: boolean;
  twelveOneMinuteRecentDays: number;
  skipOneMinute: boolean;
};

type TwelveDataResponse = {
  code?: number;
  message?: string;
  meta?: Record<string, unknown>;
  status?: string;
  values?: Array<{
    datetime?: string;
    open?: string;
    high?: string;
    low?: string;
    close?: string;
    volume?: string;
  }>;
};

const PROJECT_ROOT = process.cwd();
const ASSET_CONFIG_PATH = path.join(PROJECT_ROOT, "config", "assets.json");
const DATA_ROOT = path.join(PROJECT_ROOT, "data");
const REPORT_ROOT = path.join(PROJECT_ROOT, ".local", "intraday-downloads");

const DATABENTO_DATASET = "GLBX.MDP3";
const DATABENTO_SCHEMA = "ohlcv-1m";
const DATABENTO_CHUNK_DAYS = 365;
const TWELVE_5M_CHUNK_DAYS = 17;
const TWELVE_1M_CHUNK_DAYS = 3;
const TWELVE_INTRADAY_HISTORY_FLOOR_SECONDS = Math.floor(Date.parse("2022-01-01T00:00:00Z") / 1000);

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    fullTwelveOneMinute: false,
    twelveOneMinuteRecentDays: 30,
    skipOneMinute: false
  };

  for (const arg of argv) {
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

    if (arg === "--full-twelve-1m") {
      options.fullTwelveOneMinute = true;
      continue;
    }

    if (arg === "--skip-1m") {
      options.skipOneMinute = true;
      continue;
    }

    if (arg.startsWith("--twelve-1m-days=")) {
      const parsed = Number(arg.slice("--twelve-1m-days=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        options.twelveOneMinuteRecentDays = Math.floor(parsed);
      }
    }
  }

  return options;
}

function loadAssets(): AssetDefinition[] {
  const raw = JSON.parse(readFileSync(ASSET_CONFIG_PATH, "utf8")) as Record<string, Omit<AssetDefinition, "key">>;
  return Object.entries(raw).map(([key, asset]) => ({ key, ...asset }));
}

function firstTimestampFromExisting15m(asset: AssetDefinition): number | null {
  const filePath = path.join(DATA_ROOT, "15m", asset.dataFile);
  if (!existsSync(filePath)) return null;

  const text = readFileSync(filePath, "utf8");
  const newlineIndex = text.indexOf("\n");
  if (newlineIndex < 0) return null;
  const secondNewlineIndex = text.indexOf("\n", newlineIndex + 1);
  const firstDataLine = text.slice(newlineIndex + 1, secondNewlineIndex >= 0 ? secondNewlineIndex : text.length).trim();
  if (!firstDataLine) return null;
  const [rawTime] = firstDataLine.split(",", 1);
  const parsed = Number(rawTime);
  return Number.isFinite(parsed) ? parsed : null;
}

function floorClosedBarStart(intervalMinutes: number): number {
  const intervalSeconds = intervalMinutes * 60;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.floor(nowSeconds / intervalSeconds) * intervalSeconds - intervalSeconds;
}

function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function formatTwelveDate(seconds: number): string {
  return isoFromSeconds(seconds).slice(0, 19).replace("T", " ");
}

function normalizeDatabentoPrice(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number.NaN;
  return Math.abs(numeric) > 1_000_000 ? numeric / 1_000_000_000 : numeric;
}

function toCsvRow(bar: Bar): string {
  return `${bar.time},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}\n`;
}

function addDays(seconds: number, days: number): number {
  return seconds + days * 24 * 60 * 60;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CsvBarWriter {
  readonly targetPath: string;
  readonly tempPath: string;
  private readonly stream;
  private committed = false;
  private rowCount = 0;
  private firstTime?: number;
  private lastTime?: number;

  constructor(targetPath: string) {
    this.targetPath = targetPath;
    this.tempPath = `${targetPath}.tmp`;
    mkdirSync(path.dirname(targetPath), { recursive: true });
    this.stream = createWriteStream(this.tempPath, { encoding: "utf8" });
    this.stream.write("time,open,high,low,close,volume\n");
  }

  async writeBar(bar: Bar): Promise<void> {
    if (!this.rowCount) this.firstTime = bar.time;
    this.lastTime = bar.time;
    this.rowCount += 1;
    if (!this.stream.write(toCsvRow(bar))) {
      await once(this.stream, "drain");
    }
  }

  async finalize(complete: boolean): Promise<FileCoverage> {
    this.stream.end();
    await once(this.stream, "finish");
    if (existsSync(this.targetPath)) {
      rmSync(this.targetPath, { force: true });
    }
    renameSync(this.tempPath, this.targetPath);
    this.committed = true;
    return {
      path: path.relative(PROJECT_ROOT, this.targetPath).replace(/\\/g, "/"),
      rows: this.rowCount,
      firstTime: this.firstTime ? isoFromSeconds(this.firstTime) : undefined,
      lastTime: this.lastTime ? isoFromSeconds(this.lastTime) : undefined,
      complete
    };
  }

  cleanup(): void {
    if (this.committed) return;
    try {
      this.stream.destroy();
    } catch {
      // Best-effort cleanup for interrupted runs.
    }
    if (existsSync(this.tempPath)) {
      rmSync(this.tempPath, { force: true });
    }
  }
}

class FixedIntervalAggregator {
  private current: Bar | null = null;

  constructor(
    private readonly intervalSeconds: number,
    private readonly writer: CsvBarWriter
  ) {}

  async push(bar: Bar): Promise<void> {
    const bucketTime = Math.floor(bar.time / this.intervalSeconds) * this.intervalSeconds;
    if (!this.current || this.current.time !== bucketTime) {
      await this.flush();
      this.current = {
        time: bucketTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      };
      return;
    }

    this.current.high = Math.max(this.current.high, bar.high);
    this.current.low = Math.min(this.current.low, bar.low);
    this.current.close = bar.close;
    this.current.volume += bar.volume;
  }

  async flush(): Promise<void> {
    if (!this.current) return;
    await this.writer.writeBar(this.current);
    this.current = null;
  }
}

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
      await sleep(waitMs);
    }
  }
}

function parseDatabentoCsvBars(text: string, closedStartSeconds: number): Bar[] {
  const bars: Bar[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;

    const columns = line.split(",");
    if (columns.length < 9) continue;

    const rawTimestamp = columns[0]!;
    const seconds = Math.floor(Number(rawTimestamp) / 1_000_000_000);
    const open = normalizeDatabentoPrice(columns[4]!);
    const high = normalizeDatabentoPrice(columns[5]!);
    const low = normalizeDatabentoPrice(columns[6]!);
    const close = normalizeDatabentoPrice(columns[7]!);
    const volume = Number(columns[8]!);
    if (!Number.isFinite(seconds) || seconds > closedStartSeconds) continue;
    if ([open, high, low, close, volume].some((value) => !Number.isFinite(value))) continue;

    bars.push({ time: seconds, open, high, low, close, volume });
  }
  return bars;
}

function parseTwelveBars(values: TwelveDataResponse["values"], closedStartSeconds: number): Bar[] {
  if (!values?.length) return [];

  return values
    .map((value) => {
      if (!value.datetime) return null;
      const seconds = Math.floor(Date.parse(`${value.datetime}Z`) / 1000);
      const open = Number(value.open);
      const high = Number(value.high);
      const low = Number(value.low);
      const close = Number(value.close);
      const volume = Number(value.volume ?? 0);
      if (!Number.isFinite(seconds) || seconds > closedStartSeconds) return null;
      if ([open, high, low, close, volume].some((item) => !Number.isFinite(item))) return null;
      return { time: seconds, open, high, low, close, volume };
    })
    .filter((bar): bar is Bar => Boolean(bar));
}

async function requestDatabentoCsv(asset: AssetDefinition, startSeconds: number, endSeconds: number): Promise<string> {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DATABENTO_API_KEY");
  }
  if (!asset.databentoSymbol) {
    throw new Error(`Missing Databento symbol for ${asset.symbol}`);
  }

  const params = new URLSearchParams({
    dataset: DATABENTO_DATASET,
    schema: DATABENTO_SCHEMA,
    stype_in: "continuous",
    symbols: asset.databentoSymbol,
    start: isoFromSeconds(startSeconds),
    end: isoFromSeconds(endSeconds),
    encoding: "csv"
  });

  const response = await fetch(`https://hist.databento.com/v0/timeseries.get_range?${params.toString()}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
    }
  });

  const text = await response.text();
  if (response.ok) return text;

  if (response.status === 422) {
    let parsed: { detail?: { payload?: { available_end?: string } } } | null = null;
    try {
      parsed = JSON.parse(text) as { detail?: { payload?: { available_end?: string } } };
    } catch {
      parsed = null;
    }
    const availableEnd = parsed?.detail?.payload?.available_end;
    if (availableEnd) {
      const error = new Error(`DATABENTO_AVAILABLE_END:${availableEnd}`);
      throw error;
    }
  }

  throw new Error(`Databento ${response.status}: ${text.slice(0, 240)}`);
}

async function downloadDatabentoAsset(asset: AssetDefinition, startSeconds: number, endSeconds: number, skipOneMinute: boolean): Promise<AssetDownloadSummary> {
  const summary: AssetDownloadSummary = {
    assetKey: asset.key,
    symbol: asset.symbol,
    market: asset.market,
    provider: "databento",
    requestedStart: isoFromSeconds(startSeconds),
    requestedEnd: isoFromSeconds(endSeconds),
    files: {},
    notes: [],
    errors: []
  };

  const minuteClosedCutoff = floorClosedBarStart(1);
  const fiveMinuteClosedCutoff = floorClosedBarStart(5);
  const minuteWriter = skipOneMinute ? null : new CsvBarWriter(path.join(DATA_ROOT, "1m", asset.dataFile));
  const fiveMinuteWriter = new CsvBarWriter(path.join(DATA_ROOT, "5m", asset.dataFile));
  const fiveMinuteAggregator = new FixedIntervalAggregator(5 * 60, fiveMinuteWriter);

  let cursor = startSeconds;
  let effectiveEnd = endSeconds;
  let complete = true;
  let loggedAvailableEndNote = false;

  try {
    while (cursor <= effectiveEnd) {
      const chunkEnd = Math.min(addDays(cursor, DATABENTO_CHUNK_DAYS), effectiveEnd + 60);
      let text: string;
      try {
        text = await requestDatabentoCsv(asset, cursor, chunkEnd);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("DATABENTO_AVAILABLE_END:")) {
          const availableIso = message.slice("DATABENTO_AVAILABLE_END:".length);
          const availableSeconds = Math.floor(Date.parse(availableIso) / 1000);
          if (!Number.isFinite(availableSeconds) || availableSeconds < cursor) {
            throw error;
          }
          effectiveEnd = Math.min(effectiveEnd, availableSeconds);
          summary.requestedEnd = isoFromSeconds(effectiveEnd);
          if (!loggedAvailableEndNote) {
            summary.notes.push(`Databento currently available through ${availableIso}.`);
            loggedAvailableEndNote = true;
          }
          continue;
        }
        throw error;
      }

      const bars = parseDatabentoCsvBars(text, minuteClosedCutoff);
      for (const bar of bars) {
        if (minuteWriter && bar.time <= minuteClosedCutoff) {
          await minuteWriter.writeBar(bar);
        }
        if (bar.time <= fiveMinuteClosedCutoff) {
          await fiveMinuteAggregator.push(bar);
        }
      }

      cursor = chunkEnd;
      if (bars.length) {
        const lastTime = bars[bars.length - 1]!.time;
        console.log(`[${asset.symbol}] Databento processed through ${isoFromSeconds(lastTime)}`);
      }
    }
  } catch (error) {
    complete = false;
    const message = error instanceof Error ? error.message : String(error);
    summary.errors.push(message);
  } finally {
    await fiveMinuteAggregator.flush();
    if (minuteWriter) {
      summary.files["1m"] = await minuteWriter.finalize(complete);
    }
    summary.files["5m"] = await fiveMinuteWriter.finalize(complete);
  }

  return summary;
}

async function fetchTwelveDataBars(
  keyPool: TwelveDataKeyPool,
  symbol: string,
  interval: "1min" | "5min",
  startSeconds: number,
  endSeconds: number
): Promise<Bar[]> {
  const closedStartSeconds = floorClosedBarStart(interval === "1min" ? 1 : 5);

  while (true) {
    const { index, key } = await keyPool.acquire();
    const params = new URLSearchParams({
      symbol,
      interval,
      start_date: formatTwelveDate(startSeconds),
      end_date: formatTwelveDate(endSeconds),
      order: "ASC",
      outputsize: "5000",
      timezone: "UTC",
      apikey: key
    });

    const response = await fetch(`https://api.twelvedata.com/time_series?${params.toString()}`);
    const raw = (await response.json()) as TwelveDataResponse;
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

async function downloadTwelveTimeframe(
  keyPool: TwelveDataKeyPool,
  asset: AssetDefinition,
  interval: "1min" | "5min",
  startSeconds: number,
  endSeconds: number
): Promise<{ coverage: FileCoverage; error?: string }> {
  const writer = new CsvBarWriter(path.join(DATA_ROOT, interval === "1min" ? "1m" : "5m", asset.dataFile));
  const chunkDays = interval === "1min" ? TWELVE_1M_CHUNK_DAYS : TWELVE_5M_CHUNK_DAYS;
  const intervalSeconds = interval === "1min" ? 60 : 5 * 60;

  let cursor = startSeconds;
  let complete = true;
  let failureMessage: string | undefined;
  let chunkCount = 0;

  try {
    while (cursor <= endSeconds) {
      const chunkEnd = Math.min(endSeconds, addDays(cursor, chunkDays) - intervalSeconds);
      chunkCount += 1;
      const bars = await fetchTwelveDataBars(
        keyPool,
        asset.twelveDataSymbol ?? asset.symbol,
        interval,
        cursor,
        chunkEnd
      );

      for (const bar of bars) {
        await writer.writeBar(bar);
      }

      if (bars.length && (chunkCount % 10 === 0 || chunkEnd >= endSeconds)) {
        const lastTime = bars[bars.length - 1]!.time;
        console.log(`[${asset.symbol}] TwelveData ${interval} processed through ${isoFromSeconds(lastTime)}`);
      }

      cursor = chunkEnd + intervalSeconds;
      await sleep(150);
    }
  } catch (error) {
    complete = false;
    failureMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${asset.symbol}] TwelveData ${interval} failed: ${failureMessage}`);
  }

  return {
    coverage: await writer.finalize(complete),
    error: failureMessage
  };
}

async function downloadTwelveDataAsset(
  keyPool: TwelveDataKeyPool,
  asset: AssetDefinition,
  startSeconds: number,
  fiveMinuteEndSeconds: number,
  oneMinuteEndSeconds: number,
  options: CliOptions
): Promise<AssetDownloadSummary> {
  const summary: AssetDownloadSummary = {
    assetKey: asset.key,
    symbol: asset.symbol,
    market: asset.market,
    provider: "twelvedata",
    requestedStart: isoFromSeconds(startSeconds),
    requestedEnd: isoFromSeconds(fiveMinuteEndSeconds),
    files: {},
    notes: [],
    errors: []
  };

  try {
    const fiveMinuteResult = await downloadTwelveTimeframe(keyPool, asset, "5min", startSeconds, fiveMinuteEndSeconds);
    summary.files["5m"] = fiveMinuteResult.coverage;
    if (fiveMinuteResult.error) {
      summary.errors.push(`5m failed: ${fiveMinuteResult.error}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.errors.push(`5m failed: ${message}`);
  }

  if (options.skipOneMinute) {
    summary.notes.push("Skipped 1m download by request.");
    return summary;
  }

  const oneMinuteStart = options.fullTwelveOneMinute
    ? startSeconds
    : Math.max(startSeconds, oneMinuteEndSeconds - options.twelveOneMinuteRecentDays * 24 * 60 * 60);
  if (!options.fullTwelveOneMinute) {
    summary.notes.push(`Attempted TwelveData 1m coverage for the most recent ${options.twelveOneMinuteRecentDays} days.`);
  }

  try {
    const oneMinuteResult = await downloadTwelveTimeframe(keyPool, asset, "1min", oneMinuteStart, oneMinuteEndSeconds);
    summary.files["1m"] = oneMinuteResult.coverage;
    if (oneMinuteResult.error) {
      summary.errors.push(`1m failed: ${oneMinuteResult.error}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.errors.push(`1m failed: ${message}`);
  }

  return summary;
}

async function ensureReportRoot(): Promise<void> {
  await mkdir(REPORT_ROOT, { recursive: true });
}

async function writeReport(payload: {
  generatedAt: string;
  options: Omit<CliOptions, "assetKeys"> & { assetKeys?: string[] };
  summaries: AssetDownloadSummary[];
}): Promise<string> {
  await ensureReportRoot();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(REPORT_ROOT, `intraday-download-${timestamp}.json`);
  const latestPath = path.join(REPORT_ROOT, "latest.json");
  const text = JSON.stringify(payload, null, 2);
  await writeFile(reportPath, text, "utf8");
  await writeFile(latestPath, text, "utf8");
  return path.relative(PROJECT_ROOT, reportPath).replace(/\\/g, "/");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const assets = loadAssets().filter((asset) => !options.assetKeys || options.assetKeys.has(asset.key));
  const twelveKeys = (process.env.TWELVEDATA_API_KEYS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const keyPool = new TwelveDataKeyPool(twelveKeys);

  if (!assets.length) {
    throw new Error("No assets matched the requested filter.");
  }

  const summaries: AssetDownloadSummary[] = [];
  const needsTwelveData = assets.some((asset) => asset.market !== "futures");
  if (needsTwelveData && !twelveKeys.length) {
    throw new Error("Missing TWELVEDATA_API_KEYS for forex / gold spot assets.");
  }

  for (const asset of assets) {
    const existingStart = firstTimestampFromExisting15m(asset);
    const startSeconds =
      asset.market === "futures"
        ? existingStart ?? Math.floor(Date.parse("2010-06-06T00:00:00Z") / 1000)
        : Math.max(existingStart ?? TWELVE_INTRADAY_HISTORY_FLOOR_SECONDS, TWELVE_INTRADAY_HISTORY_FLOOR_SECONDS);
    const fiveMinuteEndSeconds = floorClosedBarStart(5);
    const oneMinuteEndSeconds = floorClosedBarStart(1);

    console.log(
      `Starting ${asset.name} (${asset.symbol}) from ${isoFromSeconds(startSeconds)} to ${isoFromSeconds(
        asset.market === "futures" ? oneMinuteEndSeconds : fiveMinuteEndSeconds
      )}...`
    );

    let summary: AssetDownloadSummary;
    if (asset.market === "futures") {
      summary = await downloadDatabentoAsset(asset, startSeconds, oneMinuteEndSeconds, options.skipOneMinute);
    } else {
      summary = await downloadTwelveDataAsset(keyPool, asset, startSeconds, fiveMinuteEndSeconds, oneMinuteEndSeconds, options);
    }

    summaries.push(summary);

    const oneMinuteRows = summary.files["1m"]?.rows ?? 0;
    const fiveMinuteRows = summary.files["5m"]?.rows ?? 0;
    console.log(
      `Finished ${asset.symbol}: 5m rows=${fiveMinuteRows}${options.skipOneMinute ? "" : `, 1m rows=${oneMinuteRows}`}${
        summary.errors.length ? `, errors=${summary.errors.length}` : ""
      }`
    );
  }

  const reportPath = await writeReport({
    generatedAt: new Date().toISOString(),
    options: {
      assetKeys: options.assetKeys ? [...options.assetKeys] : undefined,
      fullTwelveOneMinute: options.fullTwelveOneMinute,
      twelveOneMinuteRecentDays: options.twelveOneMinuteRecentDays,
      skipOneMinute: options.skipOneMinute
    },
    summaries
  });

  const success5m = summaries.filter((summary) => summary.files["5m"]?.rows).length;
  const success1m = summaries.filter((summary) => summary.files["1m"]?.rows).length;
  console.log(`Saved report to ${reportPath}`);
  console.log(`Completed ${success5m}/${summaries.length} assets with 5m data and ${success1m}/${summaries.length} assets with 1m data.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
