import { dollarPerUnit, instrumentSizeLabel } from "./instruments";
import type { StrategyPhase, StrategyRule, TradeAlert } from "./types";

export const TOPSTEP_100K_ACCOUNT = {
  startingBalance: 100_000,
  profitTarget: 6_000,
  maximumLossLimit: 3_000,
  dailyLossLimit: 2_000,
  sprintDailyLossStop: 1_200,
  sprintDailyProfitLock: 2_900,
  bestDayRecommendation: 3_000,
  maxPositionSize: 10,
  maxMicroPositionSize: 100,
  maxPerTradeRisk: 1_250,
  maxRiskPerCheck: 1_250,
  maxAlertsPerCheck: 2,
  flattenTimeCt: "3:10 PM CT",
  noNewTradesAfterCt: "3:00 PM CT"
} as const;

export function topstepMaxPositionSizeForSymbol(symbol: string): number {
  return instrumentSizeLabel(symbol, 1).toLowerCase().includes("micro")
    ? TOPSTEP_100K_ACCOUNT.maxMicroPositionSize
    : TOPSTEP_100K_ACCOUNT.maxPositionSize;
}

type ChicagoWeekday = "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";

type ChicagoParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: ChicagoWeekday;
};

export type TopstepSignalReview = {
  allowed: boolean;
  reason?: string;
  sessionKey: string;
  chicagoTime: string;
  minutesUntilFlatten: number;
  targetDollars: number;
  riskDollars: number;
  score: number;
};

const CHICAGO_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const MINUTES_TO_FLATTEN_BY_PHASE: Record<StrategyPhase, number> = {
  decile_forward_edge: 90,
  ict_sweep_fvg: 35,
  ict_turtle_soup: 120,
  mean_reversion: 220,
  momentum: 260,
  moving_average_crossover: 120,
  moving_average_touch: 160,
  percentile_range_study: 90,
  reddit_capitulation_reversion: 180,
  reddit_ema_pullback: 180,
  reddit_orb_breakout: 120,
  reddit_orb_retest: 120,
  round_number_rejection: 120,
  support_resistance_retest: 160,
  tori_trendline_mtf: 240,
  trendline_break: 240,
  vwap_pullback: 160,
  squeeze_breakout: 180
};

function chicagoParts(value: Date): ChicagoParts {
  const parts = Object.fromEntries(CHICAGO_FORMATTER.formatToParts(value).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday: parts.weekday as ChicagoWeekday
  };
}

function addLocalDays(parts: ChicagoParts, days: number): ChicagoParts {
  const noonUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return chicagoParts(noonUtc);
}

function minutesOfDay(parts: ChicagoParts): number {
  return parts.hour * 60 + parts.minute;
}

function sessionDateParts(parts: ChicagoParts): ChicagoParts {
  return minutesOfDay(parts) >= 17 * 60 ? addLocalDays(parts, 1) : parts;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function topstepRuleKey(rule: Pick<StrategyRule, "symbol" | "phase">): string {
  return `${rule.symbol}:${rule.phase}`;
}

export function topstepSessionKey(value: Date): string {
  const parts = sessionDateParts(chicagoParts(value));
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function chicagoTimeLabel(parts: ChicagoParts): string {
  return `${parts.weekday} ${pad(parts.hour)}:${pad(parts.minute)} CT`;
}

function canOpenNewTrade(parts: ChicagoParts): { allowed: boolean; reason?: string } {
  const minutes = minutesOfDay(parts);
  if (parts.weekday === "Sat") return { allowed: false, reason: "Topstep is closed on Saturday" };
  if (parts.weekday === "Sun" && minutes < 17 * 60) return { allowed: false, reason: "Topstep reopens Sunday at 5:00 PM CT" };
  if (parts.weekday === "Fri" && minutes >= 15 * 60) return { allowed: false, reason: "Topstep weekend cutoff has started" };
  if (minutes >= 15 * 60 && minutes < 17 * 60) return { allowed: false, reason: "No new Topstep trades after 3:00 PM CT" };
  return { allowed: true };
}

function minutesUntilFlatten(parts: ChicagoParts): number {
  const minutes = minutesOfDay(parts);
  if (minutes >= 17 * 60) return 24 * 60 - minutes + 15 * 60 + 10;
  return 15 * 60 + 10 - minutes;
}

export function topstepAlertDollars(trade: TradeAlert): { targetDollars: number; riskDollars: number } {
  const unitValue = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = trade.sizeMultiplier ?? 1;
  return {
    targetDollars: Math.abs(trade.tpUnits * unitValue * sizeMultiplier),
    riskDollars: Math.abs(trade.slUnits * unitValue * sizeMultiplier)
  };
}

function formatWholeDollars(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function reviewTopstepSignal(rule: StrategyRule, trade: TradeAlert): TopstepSignalReview {
  const projectedEntry = new Date(Date.parse(trade.signalTime) + 15 * 60_000);
  const parts = chicagoParts(projectedEntry);
  const clock = canOpenNewTrade(parts);
  const minutesLeft = minutesUntilFlatten(parts);
  const { targetDollars, riskDollars } = topstepAlertDollars(trade);
  const reasons: string[] = [];
  const sizeMultiplier = trade.sizeMultiplier ?? 1;

  if (rule.market !== "futures") reasons.push("Topstep Combine only permits futures products");
  if (!clock.allowed && clock.reason) reasons.push(clock.reason);
  const flattenBufferMinutes = MINUTES_TO_FLATTEN_BY_PHASE[rule.phase] ?? 180;
  if (minutesLeft < flattenBufferMinutes) {
    reasons.push(`too close to ${TOPSTEP_100K_ACCOUNT.flattenTimeCt} for ${rule.phase.replaceAll("_", " ")}`);
  }
  const maxPositionSize = topstepMaxPositionSizeForSymbol(trade.symbol);
  if (sizeMultiplier > maxPositionSize) {
    reasons.push(`size ${sizeMultiplier} exceeds ${maxPositionSize} contract max`);
  }
  if (riskDollars > TOPSTEP_100K_ACCOUNT.maxPerTradeRisk) {
    reasons.push(`risk ${formatWholeDollars(riskDollars)} exceeds ${formatWholeDollars(TOPSTEP_100K_ACCOUNT.maxPerTradeRisk)} per-trade cap`);
  }
  if (targetDollars >= TOPSTEP_100K_ACCOUNT.bestDayRecommendation) {
    reasons.push(`target ${formatWholeDollars(targetDollars)} can break the best-day consistency target`);
  }

  const boundedProfitFactor = Number.isFinite(trade.liveProfitFactor) ? Math.min(Math.max(trade.liveProfitFactor, 0), 6) : 6;
  const score =
    trade.estimatedWinRatePct / 50 +
    Math.log1p(boundedProfitFactor) +
    Math.min(targetDollars / TOPSTEP_100K_ACCOUNT.sprintDailyProfitLock, 1) * 0.75 -
    Math.min(riskDollars / TOPSTEP_100K_ACCOUNT.maxPerTradeRisk, 2) * 0.4 +
    (rule.phase === "ict_sweep_fvg" ? 0.12 : 0);

  return {
    allowed: reasons.length === 0,
    reason: reasons.join("; ") || undefined,
    sessionKey: topstepSessionKey(projectedEntry),
    chicagoTime: chicagoTimeLabel(parts),
    minutesUntilFlatten: minutesLeft,
    targetDollars,
    riskDollars,
    score
  };
}

export function topstepGuardNote(review: Pick<TopstepSignalReview, "targetDollars" | "riskDollars">): string {
  return [
    `Topstep 100K sprint guard: risk ${formatWholeDollars(review.riskDollars)} for target ${formatWholeDollars(review.targetDollars)}.`,
    `Stop for the session after one full loss or ${formatWholeDollars(TOPSTEP_100K_ACCOUNT.sprintDailyLossStop)} realized drawdown.`,
    `Lock out near ${formatWholeDollars(TOPSTEP_100K_ACCOUNT.sprintDailyProfitLock)} and stay below the ${formatWholeDollars(TOPSTEP_100K_ACCOUNT.bestDayRecommendation)} best-day line.`,
    `Be flat before ${TOPSTEP_100K_ACCOUNT.flattenTimeCt}.`
  ].join(" ");
}

export function withTopstepGuardNote(trade: TradeAlert, review: TopstepSignalReview): TradeAlert {
  return {
    ...trade,
    notes: [trade.notes, topstepGuardNote(review)].filter(Boolean).join(" ")
  };
}
