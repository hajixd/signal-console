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

/**
 * Only expose an unrealized result while both the strategy lifecycle and the
 * market mark are current. This prevents abandoned open alerts from being
 * repriced against bars recorded hours or months later.
 */
export function freshLiveTradeMark(
  trade: Pick<TradeAlert, "maxBars" | "signalTime">,
  mark: LiveTradeMark | undefined,
  now: Date,
  options: { graceMinutes?: number; maxMarkLagMinutes?: number } = {}
): LiveTradeMark | null {
  if (!mark || !Number.isFinite(mark.price) || mark.price <= 0) return null;

  const signalMs = Date.parse(trade.signalTime);
  const markMs = Date.parse(mark.time);
  const nowMs = now.getTime();
  if (![signalMs, markMs, nowMs].every(Number.isFinite)) return null;

  const maxBars = positiveFinite(trade.maxBars, DEFAULT_MAX_BARS);
  const graceMinutes = positiveFinite(options.graceMinutes, DEFAULT_GRACE_MINUTES);
  const maxMarkLagMinutes = positiveFinite(options.maxMarkLagMinutes, DEFAULT_MAX_MARK_LAG_MINUTES);
  const lifecycleDeadlineMs = signalMs + (maxBars + graceMinutes) * 60_000;
  const futureClockToleranceMs = 5 * 60_000;

  if (markMs < signalMs || markMs > nowMs + futureClockToleranceMs) return null;
  if (nowMs > lifecycleDeadlineMs) return null;
  if (nowMs - markMs > maxMarkLagMinutes * 60_000) return null;

  return mark;
}
