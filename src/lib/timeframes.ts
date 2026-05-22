export const DATA_TIMEFRAMES = ["1m", "5m", "10m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"] as const;
export type DataTimeframe = (typeof DATA_TIMEFRAMES)[number];

export const DEFAULT_STRATEGY_TIMEFRAME: DataTimeframe = "15m";
export const LIVE_SOURCE_TIMEFRAME: DataTimeframe = "5m";

export const TIMEFRAME_SECONDS: Record<DataTimeframe, number> = {
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

export const DERIVED_FROM_FIVE_MINUTE_TIMEFRAMES = ["10m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"] as const;

export function isDataTimeframe(value: string | null | undefined): value is DataTimeframe {
  return DATA_TIMEFRAMES.includes(value as DataTimeframe);
}

export function timeframeSeconds(timeframe: DataTimeframe): number {
  return TIMEFRAME_SECONDS[timeframe];
}

export function timeframeOrder(value: string): number {
  const index = DATA_TIMEFRAMES.indexOf(value as DataTimeframe);
  return index >= 0 ? index : DATA_TIMEFRAMES.length;
}

export function timeframeFromVariant(
  variantId: string | null | undefined,
  fallback: DataTimeframe = DEFAULT_STRATEGY_TIMEFRAME
): DataTimeframe {
  const raw = variantId?.split("|").find((part) => part.startsWith("tf="))?.slice(3);
  return isDataTimeframe(raw) ? raw : fallback;
}

export function closedBarStartSeconds(timeframe: DataTimeframe): number {
  const intervalSeconds = timeframeSeconds(timeframe);
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.floor(nowSeconds / intervalSeconds) * intervalSeconds - intervalSeconds;
}

export function floorToTimeframeSeconds(seconds: number, timeframe: DataTimeframe): number {
  const intervalSeconds = timeframeSeconds(timeframe);
  return Math.floor(seconds / intervalSeconds) * intervalSeconds;
}
