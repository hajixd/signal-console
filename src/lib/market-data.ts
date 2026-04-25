import { assetForKey } from "@/lib/assets";
import type { Bar, StrategyRule } from "@/lib/types";

type DatabentoRecord = {
  ts_event?: string;
  time?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
};

type OandaCandle = {
  time?: string;
  volume?: number;
  complete?: boolean;
  mid?: {
    o?: string;
    h?: string;
    l?: string;
    c?: string;
  };
};

type OandaResponse = {
  candles?: OandaCandle[];
};

function normalizePrice(value: number | string | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number.NaN;
  return Math.abs(numeric) > 1_000_000 ? numeric / 1_000_000_000 : numeric;
}

function normalizeVolume(value: number | string | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function floorTo15Minutes(date: Date): string {
  const copy = new Date(date);
  copy.setUTCSeconds(0, 0);
  const minutes = copy.getUTCMinutes();
  copy.setUTCMinutes(minutes - (minutes % 15));
  return copy.toISOString();
}

function aggregateTo15m(records: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>): Bar[] {
  const buckets = new Map<string, Bar>();
  for (const record of records.sort((left, right) => Date.parse(left.time) - Date.parse(right.time))) {
    const bucketKey = floorTo15Minutes(new Date(record.time));
    const current = buckets.get(bucketKey);
    if (!current) {
      buckets.set(bucketKey, {
        time: bucketKey,
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
    current.volume = (current.volume ?? 0) + record.volume;
  }

  const cutoff = Date.now() - 75_000;
  return [...buckets.values()].filter((bar) => Date.parse(bar.time) + 15 * 60_000 <= cutoff);
}

function parseDatabentoJson(text: string): Bar[] {
  const records: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("{\"symbol_mapping\"")) continue;
    try {
      const item = JSON.parse(trimmed) as DatabentoRecord;
      const time = item.ts_event ?? item.time;
      if (!time) continue;

      const open = normalizePrice(item.open);
      const high = normalizePrice(item.high);
      const low = normalizePrice(item.low);
      const close = normalizePrice(item.close);
      const volume = normalizeVolume(item.volume);
      if ([open, high, low, close].some((value) => !Number.isFinite(value))) continue;

      records.push({ time, open, high, low, close, volume });
    } catch {
      continue;
    }
  }
  return aggregateTo15m(records);
}

export async function fetchMarketBars(rule: StrategyRule): Promise<Bar[]> {
  const asset = assetForKey(rule.assetKey);
  if (asset.market === "futures") return fetchDatabentoBars(asset.databentoSymbol, asset.symbol);
  if (process.env.OANDA_API_TOKEN) return fetchOandaBars(asset.oandaSymbol ?? asset.symbol);
  return fetchTwelveDataBars(asset.twelveDataSymbol ?? asset.symbol);
}

async function fetchDatabentoBars(databentoSymbol: string | undefined, symbol: string): Promise<Bar[]> {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) throw new Error("Missing DATABENTO_API_KEY");
  if (!databentoSymbol) throw new Error(`Missing Databento symbol for ${symbol}`);

  const end = new Date();
  const start = new Date(end.getTime() - 12 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    dataset: "GLBX.MDP3",
    schema: "ohlcv-1m",
    stype_in: "continuous",
    symbols: databentoSymbol,
    start: start.toISOString(),
    end: end.toISOString(),
    encoding: "json"
  });

  const response = await fetch(`https://hist.databento.com/v0/timeseries.get_range?${params.toString()}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Databento ${response.status}: ${body.slice(0, 240)}`);
  }

  return parseDatabentoJson(await response.text());
}

async function fetchTwelveDataBars(symbol: string): Promise<Bar[]> {
  const keys = (process.env.TWELVEDATA_API_KEYS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!keys.length) throw new Error("Missing TWELVEDATA_API_KEYS");
  const apiKey = keys[Math.floor(Date.now() / 60_000) % keys.length];
  const params = new URLSearchParams({
    symbol,
    interval: "15min",
    outputsize: "500",
    order: "ASC",
    apikey: apiKey
  });
  const response = await fetch(`https://api.twelvedata.com/time_series?${params.toString()}`, { cache: "no-store" });
  const data = (await response.json()) as { values?: Array<Record<string, string>>; message?: string };
  if (!response.ok || !data.values) throw new Error(data.message ?? `TwelveData ${response.status}`);
  return data.values.map((item) => ({
    time: new Date(`${item.datetime}Z`).toISOString(),
    open: Number(item.open),
    high: Number(item.high),
    low: Number(item.low),
    close: Number(item.close)
  }));
}

async function fetchOandaBars(instrument: string): Promise<Bar[]> {
  const token = process.env.OANDA_API_TOKEN;
  if (!token) throw new Error("Missing OANDA_API_TOKEN");
  const baseUrl = process.env.OANDA_API_BASE_URL ?? "https://api-fxpractice.oanda.com";
  const params = new URLSearchParams({
    price: "M",
    granularity: "M15",
    count: "1500"
  });
  const response = await fetch(`${baseUrl}/v3/instruments/${instrument}/candles?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });
  const data = (await response.json()) as OandaResponse & { errorMessage?: string };
  if (!response.ok || !data.candles) throw new Error(data.errorMessage ?? `OANDA ${response.status}`);

  return data.candles
    .filter((candle) => candle.complete && candle.time && candle.mid)
    .map((candle) => ({
      time: candle.time!,
      open: Number(candle.mid!.o),
      high: Number(candle.mid!.h),
      low: Number(candle.mid!.l),
      close: Number(candle.mid!.c),
      volume: Number(candle.volume ?? 0)
    }))
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}
