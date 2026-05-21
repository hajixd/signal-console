import { autoTradeMarketForSignal, type AutoTradeMarket } from "@/lib/auto-trade-platforms";

export const PACIFIC_TIME_ZONE = "America/Los_Angeles";
export const NEW_YORK_TIME_ZONE = "America/New_York";
export const CHICAGO_TIME_ZONE = "America/Chicago";

export type ZonedDateTimeParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  weekday: number;
  year: number;
};

export type MarketSessionStatus = {
  market: AutoTradeMarket;
  open: boolean;
  reason: string;
  sessionClock: string;
  timeZone: string;
};

export type WeekendCronPause = {
  checkedAt: string;
  pacificTime: string;
  paused: boolean;
  reason?: string;
};

type MarketSessionContext = {
  assetKey?: string;
  symbol?: string;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterForZone(timeZone: string): Intl.DateTimeFormat {
  const existing = FORMATTERS.get(timeZone);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    weekday: "short",
    year: "numeric"
  });
  FORMATTERS.set(timeZone, formatter);
  return formatter;
}

export function zonedParts(value: Date, timeZone: string): ZonedDateTimeParts {
  const parts = Object.fromEntries(formatterForZone(timeZone).formatToParts(value).map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_INDEX[parts.weekday ?? ""];
  return {
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    weekday: weekday ?? 0,
    year: Number(parts.year)
  };
}

function localEpoch(parts: Pick<ZonedDateTimeParts, "day" | "hour" | "minute" | "month" | "year">): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

export function zonedDateTimeToUtc(
  parts: Pick<ZonedDateTimeParts, "day" | "hour" | "minute" | "month" | "year">,
  timeZone: string
): Date {
  let guess = localEpoch(parts);
  for (let index = 0; index < 4; index += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const delta = localEpoch(parts) - localEpoch(actual);
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

export function addCalendarDays(
  parts: Pick<ZonedDateTimeParts, "day" | "month" | "year">,
  days: number
): Pick<ZonedDateTimeParts, "day" | "month" | "year"> {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    day: value.getUTCDate(),
    month: value.getUTCMonth() + 1,
    year: value.getUTCFullYear()
  };
}

function minutesOfDay(parts: Pick<ZonedDateTimeParts, "hour" | "minute">): number {
  return parts.hour * 60 + parts.minute;
}

function isForexOpen(value: Date): boolean {
  const parts = zonedParts(value, PACIFIC_TIME_ZONE);
  const minutes = minutesOfDay(parts);

  if (parts.weekday === 0) return minutes >= 15 * 60;
  if (parts.weekday >= 1 && parts.weekday <= 4) return minutes < 14 * 60 || minutes >= 15 * 60;
  if (parts.weekday === 5) return minutes < 14 * 60;
  return false;
}

function isFuturesOpen(value: Date): boolean {
  const parts = zonedParts(value, CHICAGO_TIME_ZONE);
  const minutes = minutesOfDay(parts);

  if (parts.weekday === 0) return minutes >= 17 * 60;
  if (parts.weekday >= 1 && parts.weekday <= 4) return minutes < 16 * 60 || minutes >= 17 * 60;
  if (parts.weekday === 5) return minutes < 16 * 60;
  return false;
}

function isCornFuturesSignal(context?: MarketSessionContext): boolean {
  const symbol = context?.symbol?.trim().toUpperCase();
  return context?.assetKey === "corn_futures" || symbol === "ZC";
}

function isCornFuturesOpen(value: Date): boolean {
  const parts = zonedParts(value, CHICAGO_TIME_ZONE);
  const minutes = minutesOfDay(parts);
  const overnightSession = minutes >= 19 * 60 || minutes < 7 * 60 + 45;
  const daySession = minutes >= 8 * 60 + 30 && minutes < 13 * 60 + 20;

  if (parts.weekday === 0) return minutes >= 19 * 60;
  if (parts.weekday >= 1 && parts.weekday <= 4) return overnightSession || daySession;
  if (parts.weekday === 5) return minutes < 7 * 60 + 45 || daySession;
  return false;
}

export function marketSessionStatus(market: AutoTradeMarket, value = new Date(), context?: MarketSessionContext): MarketSessionStatus {
  if (market === "forex") {
    return {
      market,
      open: isForexOpen(value),
      reason: "Forex is treated conservatively as Sunday 3:00 PM to Friday 2:00 PM Pacific, with a daily 2:00-3:00 PM Pacific rollover window.",
      sessionClock: "Sun 3:00 PM - Fri 2:00 PM Pacific",
      timeZone: PACIFIC_TIME_ZONE
    };
  }

  if (isCornFuturesSignal(context)) {
    return {
      market,
      open: isCornFuturesOpen(value),
      reason: "Corn futures use the CBOT Globex grain schedule: Sunday-Friday 7:00 PM-7:45 AM CT plus Monday-Friday 8:30 AM-1:20 PM CT.",
      sessionClock: "Sun-Fri 7:00 PM-7:45 AM CT, Mon-Fri 8:30 AM-1:20 PM CT",
      timeZone: CHICAGO_TIME_ZONE
    };
  }

  return {
    market,
    open: isFuturesOpen(value),
    reason: "CME Globex normal week is Sunday 5:00 PM to Friday 4:00 PM Chicago time, with a daily 4:00-5:00 PM maintenance break.",
    sessionClock: "Sun 5:00 PM - Fri 4:00 PM Chicago",
    timeZone: CHICAGO_TIME_ZONE
  };
}

export function marketOpenForSignal(market: string, value = new Date(), context?: MarketSessionContext): MarketSessionStatus | null {
  const routeMarket = autoTradeMarketForSignal(market);
  return routeMarket ? marketSessionStatus(routeMarket, value, context) : null;
}

export function formatPacificTime(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: PACIFIC_TIME_ZONE,
    timeZoneName: "short",
    weekday: "short",
    year: "numeric"
  }).format(value);
}

export function formatLocalDateKey(parts: Pick<ZonedDateTimeParts, "day" | "month" | "year">): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function cronWeekendPause(value = new Date()): WeekendCronPause {
  const pacific = zonedParts(value, PACIFIC_TIME_ZONE);
  const minutes = minutesOfDay(pacific);
  const paused =
    (pacific.weekday === 5 && minutes >= 14 * 60) ||
    pacific.weekday === 6 ||
    (pacific.weekday === 0 && minutes < 15 * 60);

  return {
    checkedAt: value.toISOString(),
    pacificTime: formatPacificTime(value),
    paused,
    reason: paused
      ? "Weekend market pause: after the Friday close and before the Sunday 3:00 PM Pacific reopen."
      : undefined
  };
}

export function openMarketsForCron(markets: AutoTradeMarket[], value = new Date()): AutoTradeMarket[] {
  return markets.filter((market) => marketSessionStatus(market, value).open);
}
