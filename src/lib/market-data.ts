import { assetForKey, oandaInstrumentForAsset } from "@/lib/assets";
import {
  DEFAULT_STRATEGY_TIMEFRAME,
  LIVE_SOURCE_TIMEFRAME,
  floorToTimeframeSeconds,
  timeframeFromVariant,
  timeframeSeconds,
  type DataTimeframe
} from "@/lib/timeframes";
import { fetchProjectXMarketDataBars } from "@/lib/projectx-market-data";
import {
  markTwelveDataProviderFailure,
  twelveDataAvailable,
  twelveDataCooldownRemainingMs
} from "@/lib/market-data-provider-health";
import { sharedTwelveDataKeyRotation } from "@/lib/twelve-data-key-rotation";
import type { Bar, StrategyRule } from "@/lib/types";

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

type TwelveDataResponse = {
  code?: number;
  message?: string;
  status?: string;
  values?: Array<Record<string, string>>;
};

export type MarketBarsOptions = {
  afterSeconds?: number;
};

function closedBarCutoff(): number {
  return Date.now() - 75_000;
}

function filterClosedTimeframeBars<T extends { time: string }>(bars: T[], timeframe: DataTimeframe): T[] {
  const cutoff = closedBarCutoff();
  const intervalMs = timeframeSeconds(timeframe) * 1000;
  return bars.filter((bar) => {
    const start = Date.parse(bar.time);
    return Number.isFinite(start) && start + intervalMs <= cutoff;
  });
}

function aggregateToTimeframe(
  records: Array<{ time: string; open: number; high: number; low: number; close: number; volume?: number }>,
  timeframe: DataTimeframe
): Bar[] {
  const buckets = new Map<string, Bar>();
  for (const record of records.sort((left, right) => Date.parse(left.time) - Date.parse(right.time))) {
    const recordSeconds = Math.floor(Date.parse(record.time) / 1000);
    if (!Number.isFinite(recordSeconds)) continue;
    const bucketKey = new Date(floorToTimeframeSeconds(recordSeconds, timeframe) * 1000).toISOString();
    const current = buckets.get(bucketKey);
    if (!current) {
      buckets.set(bucketKey, {
        time: bucketKey,
        open: record.open,
        high: record.high,
        low: record.low,
        close: record.close,
        volume: record.volume ?? 0
      });
      continue;
    }
    current.high = Math.max(current.high, record.high);
    current.low = Math.min(current.low, record.low);
    current.close = record.close;
    current.volume = (current.volume ?? 0) + (record.volume ?? 0);
  }

  return filterClosedTimeframeBars([...buckets.values()], timeframe);
}

export async function fetchMarketBars(rule: StrategyRule, options: MarketBarsOptions = {}): Promise<Bar[]> {
  const asset = assetForKey(rule.assetKey);
  const sourceBars = await fetchMarketSourceBars(asset, options);
  const timeframe = timeframeFromVariant(rule.variantId, DEFAULT_STRATEGY_TIMEFRAME);
  return timeframe === LIVE_SOURCE_TIMEFRAME ? sourceBars : aggregateToTimeframe(sourceBars, timeframe);
}

export async function fetchMarketSourceBars(asset: ReturnType<typeof assetForKey>, options: MarketBarsOptions = {}): Promise<Bar[]> {
  if (asset.market === "futures") return fetchProjectXFuturesBars(asset, options);
  const failures: string[] = [];

  if (asset.market !== "crypto" && process.env.OANDA_API_TOKEN) {
    try {
      const bars = await fetchOandaBars(oandaInstrumentForAsset(asset), options);
      if (bars.length) return bars;
      failures.push("OANDA returned no closed bars");
    } catch (error) {
      failures.push(`OANDA: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  if (!twelveDataAvailable()) {
    failures.push(`TwelveData quota cooldown (${Math.ceil(twelveDataCooldownRemainingMs() / 60_000)}m remaining)`);
    throw new Error(`Configured market data providers are unavailable for ${asset.symbol}: ${failures.join(" | ")}`);
  }

  try {
    const bars = await fetchTwelveDataBars(asset.twelveDataSymbol ?? asset.symbol, options);
    if (bars.length) return bars;
    failures.push("TwelveData returned no closed bars");
  } catch (error) {
    markTwelveDataProviderFailure(error);
    failures.push(`TwelveData: ${error instanceof Error ? error.message : "Unknown error"}`);
  }

  throw new Error(`Configured market data providers failed for ${asset.symbol}: ${failures.join(" | ")}`);
}

function providerStartDate(options: MarketBarsOptions, fallbackLookbackMs: number, intervalSeconds: number): Date {
  const start = options.afterSeconds
    ? new Date((options.afterSeconds + intervalSeconds) * 1000)
    : new Date(Date.now() - fallbackLookbackMs);
  start.setUTCSeconds(0, 0);
  return start;
}

async function fetchProjectXFuturesBars(asset: ReturnType<typeof assetForKey>, options: MarketBarsOptions): Promise<Bar[]> {
  const start = providerStartDate(options, 12 * 24 * 60 * 60 * 1000, timeframeSeconds(LIVE_SOURCE_TIMEFRAME));
  const end = new Date();
  end.setUTCSeconds(0, 0);

  const bars = await fetchProjectXMarketDataBars(asset, {
    endSeconds: Math.floor(end.getTime() / 1000),
    limit: 20_000,
    startSeconds: Math.floor(start.getTime() / 1000),
    unit: 2,
    unitNumber: 1
  });

  return filterClosedTimeframeBars(
    bars.map((bar) => ({
      time: new Date(bar.time * 1000).toISOString(),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume
    })),
    LIVE_SOURCE_TIMEFRAME
  );
}

async function fetchTwelveDataBars(symbol: string, options: MarketBarsOptions): Promise<Bar[]> {
  const keys = (process.env.TWELVEDATA_API_KEYS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!keys.length) throw new Error("Missing TWELVEDATA_API_KEYS");
  const orderedKeys = sharedTwelveDataKeyRotation.orderedKeys(keys);
  if (!orderedKeys.length) throw new Error("All configured TwelveData API keys are cooling down for the current minute.");
  const failures: string[] = [];

  for (const apiKey of orderedKeys) {
    const params = new URLSearchParams({
      symbol,
      interval: "5min",
      outputsize: options.afterSeconds ? "5000" : "500",
      order: "ASC",
      timezone: "UTC",
      apikey: apiKey
    });
    if (options.afterSeconds) {
      params.set(
        "start_date",
        providerStartDate(options, 0, timeframeSeconds(LIVE_SOURCE_TIMEFRAME)).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")
      );
      params.set("end_date", endIsoMinute().replace("T", " ").replace(/\.\d{3}Z$/, ""));
    }
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
      sharedTwelveDataKeyRotation.markSuccess(apiKey);
      return filterClosedTimeframeBars(
        data.values
          .map((item) => ({
            time: new Date(`${item.datetime}Z`).toISOString(),
            open: Number(item.open),
            high: Number(item.high),
            low: Number(item.low),
            close: Number(item.close),
            volume: Number(item.volume ?? 0)
          }))
          .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
          .sort((left, right) => Date.parse(left.time) - Date.parse(right.time)),
        LIVE_SOURCE_TIMEFRAME
      );
    }

    const reason = data.message ?? data.status ?? `HTTP ${response.status}`;
    sharedTwelveDataKeyRotation.markFailure(apiKey, `${response.status}: ${reason}`);
    failures.push(`...${apiKey.slice(-4)}: ${reason}`);
  }

  throw new Error(`TwelveData failed for all API keys: ${failures.join(" | ")}`);
}

async function fetchOandaBars(instrument: string, options: MarketBarsOptions): Promise<Bar[]> {
  const token = process.env.OANDA_API_TOKEN;
  if (!token) throw new Error("Missing OANDA_API_TOKEN");
  const baseUrl = process.env.OANDA_API_BASE_URL ?? "https://api-fxpractice.oanda.com";
  const params = new URLSearchParams({
    price: "M",
    granularity: "M5"
  });
  if (options.afterSeconds) {
    params.set("from", providerStartDate(options, 0, timeframeSeconds(LIVE_SOURCE_TIMEFRAME)).toISOString());
    params.set("to", endIsoMinute());
  } else {
    params.set("count", "1500");
  }
  const response = await fetch(`${baseUrl}/v3/instruments/${instrument}/candles?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });
  const data = (await response.json()) as OandaResponse & { errorMessage?: string };
  if (!response.ok || !data.candles) throw new Error(data.errorMessage ?? `OANDA ${response.status}`);

  return filterClosedTimeframeBars(
    data.candles
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
      .sort((left, right) => Date.parse(left.time) - Date.parse(right.time)),
    LIVE_SOURCE_TIMEFRAME
  );
}

function endIsoMinute(): string {
  const end = new Date();
  end.setUTCSeconds(0, 0);
  return end.toISOString();
}
