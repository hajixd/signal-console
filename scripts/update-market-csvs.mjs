import { access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIFTEEN_MINUTES_SECONDS = 15 * 60;
const FIFTEEN_MINUTES_MS = FIFTEEN_MINUTES_SECONDS * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATABENTO_CHUNK_MS = 90 * DAY_MS;
const OANDA_CHUNK_MS = 45 * DAY_MS;

const FUTURES_ASSETS = [
  { symbol: "6A", databentoSymbol: "6A.v.0", path: "data/market/futures/6a_databento_volume_front_15m.csv" },
  { symbol: "6B", databentoSymbol: "6B.v.0", path: "data/market/futures/6b_databento_volume_front_15m.csv" },
  { symbol: "6C", databentoSymbol: "6C.v.0", path: "data/market/futures/6c_databento_volume_front_15m.csv" },
  { symbol: "6E", databentoSymbol: "6E.v.0", path: "data/market/futures/6e_databento_volume_front_15m.csv" },
  { symbol: "6J", databentoSymbol: "6J.v.0", path: "data/market/futures/6j_databento_volume_front_15m.csv" },
  { symbol: "CL", databentoSymbol: "CL.v.0", path: "data/market/futures/cl_databento_volume_front_15m.csv" },
  { symbol: "ES", databentoSymbol: "ES.v.0", path: "data/market/futures/es_databento_volume_front_15m.csv" },
  { symbol: "GC", databentoSymbol: "GC.v.0", path: "data/market/futures/gc_databento_volume_front_15m.csv" },
  { symbol: "HG", databentoSymbol: "HG.v.0", path: "data/market/futures/hg_databento_volume_front_15m.csv" },
  { symbol: "NG", databentoSymbol: "NG.v.0", path: "data/market/futures/ng_databento_volume_front_15m.csv" },
  { symbol: "NQ", databentoSymbol: "NQ.v.0", path: "data/market/futures/nq_databento_volume_front_15m.csv" },
  { symbol: "RTY", databentoSymbol: "RTY.v.0", path: "data/market/futures/rty_databento_volume_front_15m.csv" },
  { symbol: "SI", databentoSymbol: "SI.v.0", path: "data/market/futures/si_databento_volume_front_15m.csv" },
  { symbol: "YM", databentoSymbol: "YM.v.0", path: "data/market/futures/ym_databento_volume_front_15m.csv" },
  { symbol: "ZB", databentoSymbol: "ZB.v.0", path: "data/market/futures/zb_databento_volume_front_15m.csv" },
  { symbol: "ZN", databentoSymbol: "ZN.v.0", path: "data/market/futures/zn_databento_volume_front_15m.csv" }
];

const OANDA_ASSETS = [
  { symbol: "AUDUSD", instrument: "AUD_USD", path: "data/market/forex/audusd_twelvedata_15m.csv" },
  { symbol: "EURUSD", instrument: "EUR_USD", path: "data/market/forex/eurusd_twelvedata_15m.csv" },
  { symbol: "GBPUSD", instrument: "GBP_USD", path: "data/market/forex/gbpusd_twelvedata_15m.csv" },
  { symbol: "NZDUSD", instrument: "NZD_USD", path: "data/market/forex/nzdusd_twelvedata_15m.csv" },
  { symbol: "USDCAD", instrument: "USD_CAD", path: "data/market/forex/usdcad_twelvedata_15m.csv" },
  { symbol: "USDCHF", instrument: "USD_CHF", path: "data/market/forex/usdchf_twelvedata_15m.csv" },
  { symbol: "USDJPY", instrument: "USD_JPY", path: "data/market/forex/usdjpy_twelvedata_15m.csv" },
  { symbol: "XAUUSD", instrument: "XAU_USD", path: "data/market/reference/xauusd_oanda_15m.csv" }
];

function parseArgs(argv) {
  const args = {
    dryRun: false,
    groups: new Set(["all"]),
    symbols: null
  };

  for (const rawArg of argv) {
    if (rawArg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (rawArg.startsWith("--group=")) {
      args.groups = new Set(
        rawArg
          .slice("--group=".length)
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      );
      continue;
    }
    if (rawArg.startsWith("--symbols=")) {
      args.symbols = new Set(
        rawArg
          .slice("--symbols=".length)
          .split(",")
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean)
      );
    }
  }

  return args;
}

async function loadEnvFile(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  try {
    await access(filePath, fsConstants.F_OK);
  } catch {
    return;
  }

  const text = await readFile(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function loadLocalEnv() {
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");
}

function wantsGroup(args, name) {
  if (args.groups.has("all")) return true;
  if (name === "spot") return args.groups.has("spot") || args.groups.has("forex") || args.groups.has("reference");
  return args.groups.has(name);
}

function filterAssets(assets, args) {
  if (!args.symbols?.size) return assets;
  return assets.filter((asset) => args.symbols.has(asset.symbol));
}

async function readCsvRange(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  const text = await readFile(filePath, "utf8");
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`No data rows found in ${relativePath}`);
  }

  const firstTimestamp = Number(lines[1].split(",", 1)[0]);
  const lastTimestamp = Number(lines.at(-1)?.split(",", 1)[0] ?? "");
  if (!Number.isFinite(firstTimestamp) || !Number.isFinite(lastTimestamp)) {
    throw new Error(`Could not parse timestamp range from ${relativePath}`);
  }

  return {
    firstTimestamp,
    lastTimestamp
  };
}

function normalizeDatabentoPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number.NaN;
  return Math.abs(numeric) > 1_000_000 ? numeric / 1_000_000_000 : numeric;
}

function normalizeVolume(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function aggregateTo15m(records) {
  const buckets = new Map();
  const sorted = [...records].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));

  for (const record of sorted) {
    const bucketMs = Math.floor(Date.parse(record.time) / FIFTEEN_MINUTES_MS) * FIFTEEN_MINUTES_MS;
    const bucketTime = Math.floor(bucketMs / 1000);
    const current = buckets.get(bucketTime);
    if (!current) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: record.open,
        high: record.high,
        low: record.low,
        close: record.close,
        volume: record.volume
      });
      continue;
    }

    current.high = Math.max(current.high, record.high);
    current.low = Math.min(current.low, record.low);
    current.close = record.close;
    current.volume += record.volume;
  }

  return [...buckets.values()].sort((left, right) => left.time - right.time);
}

function parseDatabentoChunk(text) {
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('{"symbol_mapping"')) continue;

    try {
      const item = JSON.parse(trimmed);
      const time = item.ts_event ?? item.time;
      if (!time) continue;

      const open = normalizeDatabentoPrice(item.open);
      const high = normalizeDatabentoPrice(item.high);
      const low = normalizeDatabentoPrice(item.low);
      const close = normalizeDatabentoPrice(item.close);
      const volume = normalizeVolume(item.volume);
      if (![open, high, low, close].every(Number.isFinite)) continue;

      records.push({ time, open, high, low, close, volume });
    } catch {
      continue;
    }
  }

  return aggregateTo15m(records);
}

async function fetchDatabentoChunk(asset, start, end, apiKey) {
  const params = new URLSearchParams({
    dataset: "GLBX.MDP3",
    schema: "ohlcv-1m",
    stype_in: "continuous",
    symbols: asset.databentoSymbol,
    start: start.toISOString(),
    end: end.toISOString(),
    encoding: "json"
  });

  const response = await fetch(`https://hist.databento.com/v0/timeseries.get_range?${params.toString()}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Databento ${response.status}: ${body.slice(0, 240)}`);
  }

  return parseDatabentoChunk(await response.text());
}

async function rebuildFuturesAsset(asset, args) {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DATABENTO_API_KEY");
  }

  const range = await readCsvRange(asset.path);
  const bars = [];
  const startMs = range.firstTimestamp * 1000;
  const endMs = (range.lastTimestamp + FIFTEEN_MINUTES_SECONDS) * 1000;
  const totalChunks = Math.max(1, Math.ceil((endMs - startMs) / DATABENTO_CHUNK_MS));
  let chunkIndex = 0;

  for (let cursor = startMs; cursor < endMs; cursor += DATABENTO_CHUNK_MS) {
    chunkIndex += 1;
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(Math.min(endMs, cursor + DATABENTO_CHUNK_MS));
    console.log(`[futures] ${asset.symbol} chunk ${chunkIndex}/${totalChunks} ${chunkStart.toISOString()} -> ${chunkEnd.toISOString()}`);
    const chunkBars = await fetchDatabentoChunk(asset, chunkStart, chunkEnd, apiKey);
    bars.push(...chunkBars);
  }

  const deduped = [...new Map(bars.map((bar) => [bar.time, bar])).values()]
    .filter((bar) => bar.time >= range.firstTimestamp && bar.time <= range.lastTimestamp)
    .sort((left, right) => left.time - right.time);

  await writeCsv(asset.path, deduped, args.dryRun);
  console.log(`[futures] ${asset.symbol} rows=${deduped.length}${args.dryRun ? " (dry-run)" : ""}`);
}

async function fetchOandaChunk(asset, start, end, token, baseUrl) {
  const params = new URLSearchParams({
    price: "M",
    granularity: "M15",
    from: start.toISOString(),
    to: end.toISOString()
  });

  const response = await fetch(`${baseUrl}/v3/instruments/${asset.instrument}/candles?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await response.json();
  if (!response.ok || !Array.isArray(data.candles)) {
    throw new Error(data.errorMessage ?? `OANDA ${response.status}`);
  }

  return data.candles
    .filter((candle) => candle.complete && candle.time && candle.mid)
    .map((candle) => ({
      time: Math.floor(Date.parse(candle.time) / 1000),
      open: Number(candle.mid.o),
      high: Number(candle.mid.h),
      low: Number(candle.mid.l),
      close: Number(candle.mid.c),
      volume: normalizeVolume(candle.volume)
    }))
    .filter((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
}

async function rebuildOandaAsset(asset, args) {
  const token = process.env.OANDA_API_TOKEN;
  if (!token) {
    throw new Error("Missing OANDA_API_TOKEN");
  }

  const baseUrl = process.env.OANDA_API_BASE_URL ?? "https://api-fxpractice.oanda.com";
  const range = await readCsvRange(asset.path);
  const bars = [];
  const startMs = range.firstTimestamp * 1000;
  const endMs = (range.lastTimestamp + FIFTEEN_MINUTES_SECONDS) * 1000;
  const totalChunks = Math.max(1, Math.ceil((endMs - startMs) / OANDA_CHUNK_MS));
  let chunkIndex = 0;

  for (let cursor = startMs; cursor < endMs; cursor += OANDA_CHUNK_MS) {
    chunkIndex += 1;
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(Math.min(endMs, cursor + OANDA_CHUNK_MS));
    console.log(`[spot] ${asset.symbol} chunk ${chunkIndex}/${totalChunks} ${chunkStart.toISOString()} -> ${chunkEnd.toISOString()}`);
    const chunkBars = await fetchOandaChunk(asset, chunkStart, chunkEnd, token, baseUrl);
    bars.push(...chunkBars);
  }

  const deduped = [...new Map(bars.map((bar) => [bar.time, bar])).values()]
    .filter((bar) => bar.time >= range.firstTimestamp && bar.time <= range.lastTimestamp)
    .sort((left, right) => left.time - right.time);

  await writeCsv(asset.path, deduped, args.dryRun);
  console.log(`[spot] ${asset.symbol} rows=${deduped.length}${args.dryRun ? " (dry-run)" : ""}`);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return String(Number(value));
}

async function writeCsv(relativePath, bars, dryRun) {
  const lines = ["time,open,high,low,close,volume"];
  for (const bar of bars) {
    lines.push(
      [
        String(bar.time),
        formatNumber(bar.open),
        formatNumber(bar.high),
        formatNumber(bar.low),
        formatNumber(bar.close),
        formatNumber(bar.volume)
      ].join(",")
    );
  }

  if (dryRun) return;
  const filePath = path.join(ROOT, relativePath);
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await loadLocalEnv();

  const futuresAssets = filterAssets(FUTURES_ASSETS, args);
  const oandaAssets = filterAssets(OANDA_ASSETS, args);

  if (!futuresAssets.length && !oandaAssets.length) {
    throw new Error("No matching assets for the requested filters");
  }

  if (wantsGroup(args, "futures")) {
    for (const asset of futuresAssets) {
      await rebuildFuturesAsset(asset, args);
    }
  }

  if (wantsGroup(args, "spot")) {
    for (const asset of oandaAssets) {
      await rebuildOandaAsset(asset, args);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
