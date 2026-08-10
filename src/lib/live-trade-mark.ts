import type { TradeAlert } from "@/lib/types";

export type LiveTradeMark = {
  price: number;
  time: string;
};

const DEFAULT_MAX_BARS = 24;
const DEFAULT_GRACE_MINUTES = 15;
const DEFAULT_MAX_MARK_LAG_MINUTES = 15;

function positiveFinite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Only expose an unrealized estimate from a recent post-entry market mark. */
export function freshLiveTradeMark(
  trade: Pick<TradeAlert, "maxBars" | "signalTime">,
  mark: LiveTradeMark | undefined,
  now: Date,
  options: { maxMarkLagMinutes?: number } = {}
): LiveTradeMark | null {
  if (!mark || !Number.isFinite(mark.price) || mark.price <= 0) return null;

  const signalMs = Date.parse(trade.signalTime);
  const markMs = Date.parse(mark.time);
  const nowMs = now.getTime();
  if (![signalMs, markMs, nowMs].every(Number.isFinite)) return null;

  const maxMarkLagMinutes = positiveFinite(options.maxMarkLagMinutes, DEFAULT_MAX_MARK_LAG_MINUTES);
  const futureClockToleranceMs = 5 * 60_000;

  if (markMs < signalMs || markMs > nowMs + futureClockToleranceMs) return null;
  if (nowMs - markMs > maxMarkLagMinutes * 60_000) return null;

  return mark;
}

/** Whether the available one-minute candles can still form a truthful contiguous chart. */
export function liveTradeChartPathIsCurrent(
  trade: Pick<TradeAlert, "maxBars" | "signalTime">,
  now: Date,
  graceMinutes = DEFAULT_GRACE_MINUTES
): boolean {
  const signalMs = Date.parse(trade.signalTime);
  const nowMs = now.getTime();
  if (!Number.isFinite(signalMs) || !Number.isFinite(nowMs)) return false;
  const maxBars = positiveFinite(trade.maxBars, DEFAULT_MAX_BARS);
  const grace = positiveFinite(graceMinutes, DEFAULT_GRACE_MINUTES);
  return nowMs <= signalMs + (maxBars + grace) * 60_000;
}
