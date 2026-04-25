import { TOPSTEP_100K_ACCOUNT, topstepSessionKey } from "./topstep";

export type ChallengeReplayTrade = {
  entryTime: string;
  pnlDollars: number;
};

export type ChallengeRules = {
  startingBalance: number;
  profitTarget: number;
  maximumLossLimit: number;
  dailyLossLimit: number;
  dailyProfitLock: number;
  dailyLossStop: number;
};

export type ChallengeMethodStats = {
  method: "historical" | "montecarlo";
  passRatePct: number;
  passCount: number;
  failCount: number;
  incompleteCount: number;
  totalSimulations: number;
  avgTradesToPass: number;
  medianTradesToPass: number;
  avgMinutesToPass: number;
  medianMinutesToPass: number;
  avgTradesToFail: number;
  medianTradesToFail: number;
  avgMinutesToFail: number;
  medianMinutesToFail: number;
  avgWinRatePassPct: number;
  medianWinRatePassPct: number;
  avgFinalPnl: number;
  p10FinalPnl: number;
  p50FinalPnl: number;
  p90FinalPnl: number;
};

export type ChallengePassRateHorizon = {
  key: "7d" | "14d" | "30d" | "eventual";
  label: string;
  days: number | null;
  passRatePct: number;
  passCount: number;
  failCount: number;
  incompleteCount: number;
  totalSimulations: number;
};

export type ChallengeReplaySummary = {
  eligibleTrades: number;
  historicalSessions: number;
  avgTradeGapMinutes: number;
  historicalPassRates: ChallengePassRateHorizon[];
  monteCarloPassRates: ChallengePassRateHorizon[];
  historical: ChallengeMethodStats;
  monteCarlo: ChallengeMethodStats;
};

type PreparedTrade = {
  entryTimeMs: number;
  sessionKey: string;
  pnlDollars: number;
};

type SessionTemplate = {
  startTimeMs: number;
  tradeOffsetsMs: number[];
  spanMs: number;
};

type ReplayOutcome = {
  status: "pass" | "fail" | "incomplete";
  trades: number;
  minutes: number;
  winRate: number;
  finalPnl: number;
};

const MONTE_CARLO_SIMS = 2_000;
const MINUTES_PER_DAY = 1_440;
const PASS_RATE_HORIZONS = [
  { key: "7d", label: "7 Day Pass Rate", days: 7, minutes: 7 * MINUTES_PER_DAY },
  { key: "14d", label: "14 Day Pass Rate", days: 14, minutes: 14 * MINUTES_PER_DAY },
  { key: "30d", label: "30 Day Pass Rate", days: 30, minutes: 30 * MINUTES_PER_DAY },
  { key: "eventual", label: "Eventual Pass Rate", days: null, minutes: undefined }
] as const;

export const DEFAULT_CHALLENGE_RULES: ChallengeRules = {
  startingBalance: TOPSTEP_100K_ACCOUNT.startingBalance,
  profitTarget: TOPSTEP_100K_ACCOUNT.profitTarget,
  maximumLossLimit: TOPSTEP_100K_ACCOUNT.maximumLossLimit,
  dailyLossLimit: TOPSTEP_100K_ACCOUNT.dailyLossLimit,
  dailyProfitLock: TOPSTEP_100K_ACCOUNT.sprintDailyProfitLock,
  dailyLossStop: TOPSTEP_100K_ACCOUNT.sprintDailyLossStop
};

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  return Date.parse(value.replace(" ", "T"));
}

function median(values: number[]): number {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) return 0;
  const middle = Math.floor(filtered.length / 2);
  return filtered.length % 2 ? filtered[middle] : (filtered[middle - 1] + filtered[middle]) / 2;
}

function average(values: number[]): number {
  const filtered = values.filter((value) => Number.isFinite(value));
  return filtered.length ? filtered.reduce((sum, value) => sum + value, 0) / filtered.length : 0;
}

function percentile(values: number[], pct: number): number {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) return 0;
  const index = Math.min(filtered.length - 1, Math.max(0, Math.round((filtered.length - 1) * pct)));
  return filtered[index];
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seedValue: string): () => number {
  let seed = hashSeed(seedValue) || 1;
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function prepareTrades(trades: ChallengeReplayTrade[]): PreparedTrade[] {
  return trades
    .map((trade) => {
      const entryTimeMs = parseTimestamp(trade.entryTime);
      return {
        entryTimeMs,
        sessionKey: Number.isFinite(entryTimeMs) ? topstepSessionKey(new Date(entryTimeMs)) : "",
        pnlDollars: trade.pnlDollars
      };
    })
    .filter((trade) => Number.isFinite(trade.entryTimeMs) && Number.isFinite(trade.pnlDollars))
    .sort((left, right) => left.entryTimeMs - right.entryTimeMs);
}

function avgTradeGapMinutes(trades: PreparedTrade[]): number {
  if (trades.length < 2) return 1_440;
  const gaps: number[] = [];
  for (let index = 1; index < trades.length; index += 1) {
    const gap = (trades[index].entryTimeMs - trades[index - 1].entryTimeMs) / 60_000;
    if (gap > 0) gaps.push(gap);
  }
  return average(gaps) || 1_440;
}

function sessionStarts(trades: PreparedTrade[]): number[] {
  const starts = new Map<string, number>();
  for (const trade of trades) {
    if (!starts.has(trade.sessionKey)) starts.set(trade.sessionKey, trade.entryTimeMs);
  }
  return [...starts.values()].sort((left, right) => left - right);
}

function sessionTemplates(trades: PreparedTrade[]): SessionTemplate[] {
  const grouped = new Map<string, number[]>();
  for (const trade of trades) {
    const bucket = grouped.get(trade.sessionKey) ?? [];
    bucket.push(trade.entryTimeMs);
    grouped.set(trade.sessionKey, bucket);
  }

  return [...grouped.values()]
    .map((times) => times.sort((left, right) => left - right))
    .filter((times) => times.length > 0)
    .map((times) => {
      const startTimeMs = times[0]!;
      const tradeOffsetsMs = times.map((time) => Math.max(0, time - startTimeMs));
      return {
        startTimeMs,
        tradeOffsetsMs,
        spanMs: tradeOffsetsMs[tradeOffsetsMs.length - 1] ?? 0
      };
    })
    .sort((left, right) => left.startTimeMs - right.startTimeMs);
}

function sessionStartGapsMs(templates: SessionTemplate[]): number[] {
  if (templates.length < 2) return [86_400_000];
  const gaps: number[] = [];
  for (let index = 1; index < templates.length; index += 1) {
    const gap = templates[index]!.startTimeMs - templates[index - 1]!.startTimeMs;
    if (gap > 0) gaps.push(gap);
  }
  return gaps.length ? gaps : [86_400_000];
}

function replayTrades(trades: PreparedTrade[], startMs: number, rules: ChallengeRules, horizonMinutes?: number): ReplayOutcome {
  let balance = rules.startingBalance;
  let lossFloor = rules.startingBalance - rules.maximumLossLimit;
  let currentSessionKey = "";
  let dailyPnl = 0;
  let sessionStopped = false;
  let tradeCount = 0;
  let wins = 0;
  let endTimeMs = startMs;
  const deadlineMs = horizonMinutes && horizonMinutes > 0 ? startMs + horizonMinutes * 60_000 : Infinity;

  function closeSession() {
    if (!currentSessionKey) return;
    lossFloor = Math.min(
      rules.startingBalance,
      Math.max(lossFloor, balance - rules.maximumLossLimit)
    );
  }

  for (const trade of trades) {
    if (trade.entryTimeMs < startMs) continue;
    if (trade.entryTimeMs > deadlineMs) break;

    if (trade.sessionKey !== currentSessionKey) {
      closeSession();
      currentSessionKey = trade.sessionKey;
      dailyPnl = 0;
      sessionStopped = false;
    }

    if (sessionStopped) continue;

    tradeCount += 1;
    if (trade.pnlDollars > 0) wins += 1;
    dailyPnl += trade.pnlDollars;
    balance += trade.pnlDollars;
    endTimeMs = trade.entryTimeMs;

    if ((rules.maximumLossLimit > 0 && balance <= lossFloor) || (rules.dailyLossLimit > 0 && dailyPnl <= -rules.dailyLossLimit)) {
      return {
        status: "fail",
        trades: tradeCount,
        minutes: Math.max(0, (endTimeMs - startMs) / 60_000),
        winRate: tradeCount ? wins / tradeCount : 0,
        finalPnl: balance - rules.startingBalance
      };
    }

    if (balance - rules.startingBalance >= rules.profitTarget) {
      return {
        status: "pass",
        trades: tradeCount,
        minutes: Math.max(0, (endTimeMs - startMs) / 60_000),
        winRate: tradeCount ? wins / tradeCount : 0,
        finalPnl: balance - rules.startingBalance
      };
    }

    if (
      (rules.dailyProfitLock > 0 && dailyPnl >= rules.dailyProfitLock) ||
      (rules.dailyLossStop > 0 && dailyPnl <= -rules.dailyLossStop)
    ) {
      sessionStopped = true;
    }
  }

  closeSession();
  return {
    status: "incomplete",
    trades: tradeCount,
    minutes: Math.max(0, (endTimeMs - startMs) / 60_000),
    winRate: tradeCount ? wins / tradeCount : 0,
    finalPnl: balance - rules.startingBalance
  };
}

function statsFromOutcomes(method: ChallengeMethodStats["method"], outcomes: ReplayOutcome[]): ChallengeMethodStats {
  const passes = outcomes.filter((outcome) => outcome.status === "pass");
  const fails = outcomes.filter((outcome) => outcome.status === "fail");
  const finals = outcomes.map((outcome) => outcome.finalPnl);
  const passWinRates = passes.map((outcome) => outcome.winRate * 100);

  return {
    method,
    passRatePct: outcomes.length ? (passes.length / outcomes.length) * 100 : 0,
    passCount: passes.length,
    failCount: fails.length,
    incompleteCount: outcomes.length - passes.length - fails.length,
    totalSimulations: outcomes.length,
    avgTradesToPass: average(passes.map((outcome) => outcome.trades)),
    medianTradesToPass: median(passes.map((outcome) => outcome.trades)),
    avgMinutesToPass: average(passes.map((outcome) => outcome.minutes)),
    medianMinutesToPass: median(passes.map((outcome) => outcome.minutes)),
    avgTradesToFail: average(fails.map((outcome) => outcome.trades)),
    medianTradesToFail: median(fails.map((outcome) => outcome.trades)),
    avgMinutesToFail: average(fails.map((outcome) => outcome.minutes)),
    medianMinutesToFail: median(fails.map((outcome) => outcome.minutes)),
    avgWinRatePassPct: average(passWinRates),
    medianWinRatePassPct: median(passWinRates),
    avgFinalPnl: average(finals),
    p10FinalPnl: percentile(finals, 0.1),
    p50FinalPnl: percentile(finals, 0.5),
    p90FinalPnl: percentile(finals, 0.9)
  };
}

function passRateFromOutcomes(
  horizon: (typeof PASS_RATE_HORIZONS)[number],
  outcomes: ReplayOutcome[]
): ChallengePassRateHorizon {
  const stats = statsFromOutcomes("historical", outcomes);
  return {
    key: horizon.key,
    label: horizon.label,
    days: horizon.days,
    passRatePct: stats.passRatePct,
    passCount: stats.passCount,
    failCount: stats.failCount,
    incompleteCount: stats.incompleteCount,
    totalSimulations: stats.totalSimulations
  };
}

function buildMonteCarloTrades(sourceTrades: PreparedTrade[], rng: () => number): PreparedTrade[] {
  const pnls = sourceTrades.map((trade) => trade.pnlDollars);
  const templates = sessionTemplates(sourceTrades);
  const startGapsMs = sessionStartGapsMs(templates);
  const firstMs = templates[0]?.startTimeMs ?? sourceTrades[0]?.entryTimeMs ?? Date.now();
  const generated: PreparedTrade[] = [];
  let sessionStartMs = firstMs;
  let previousSessionSpanMs = 0;

  for (let sessionIndex = 0; generated.length < sourceTrades.length; sessionIndex += 1) {
    // Keep Monte Carlo timing grounded in real behavior by resampling historical
    // session shapes and start-to-start gaps instead of inventing a flat daily cadence.
    const template = templates[Math.floor(rng() * templates.length)] ?? templates[0];
    if (!template) break;
    if (sessionIndex > 0) {
      const sampledGapMs = startGapsMs[Math.floor(rng() * startGapsMs.length)] ?? 86_400_000;
      sessionStartMs += Math.max(sampledGapMs, previousSessionSpanMs + 60_000);
    }
    previousSessionSpanMs = template.spanMs;
    for (const offsetMs of template.tradeOffsetsMs) {
      if (generated.length >= sourceTrades.length) break;
      generated.push({
        entryTimeMs: sessionStartMs + offsetMs,
        sessionKey: `mc-${sessionIndex}`,
        pnlDollars: pnls[Math.floor(rng() * pnls.length)] ?? 0
      });
    }
  }

  return generated;
}

export function analyzePropFirmChallenge(trades: ChallengeReplayTrade[], seed: string, rules: ChallengeRules): ChallengeReplaySummary {
  const prepared = prepareTrades(trades);
  const starts = sessionStarts(prepared);
  const tradeGapMinutes = avgTradeGapMinutes(prepared);
  const emptyPassRates = PASS_RATE_HORIZONS.map((horizon) => passRateFromOutcomes(horizon, []));

  if (!prepared.length) {
    const empty = statsFromOutcomes("historical", []);
    return {
      eligibleTrades: 0,
      historicalSessions: 0,
      avgTradeGapMinutes: 0,
      historicalPassRates: emptyPassRates,
      monteCarloPassRates: emptyPassRates,
      historical: empty,
      monteCarlo: { ...empty, method: "montecarlo" }
    };
  }

  const historicalOutcomes = starts.map((startMs) => replayTrades(prepared, startMs, rules)).filter((outcome) => outcome.trades > 0);
  const historicalPassRates = PASS_RATE_HORIZONS.map((horizon) => {
    const outcomes =
      horizon.minutes == null
        ? historicalOutcomes
        : starts
            .map((startMs) => replayTrades(prepared, startMs, rules, horizon.minutes))
            .filter((outcome) => outcome.trades > 0);
    return passRateFromOutcomes(horizon, outcomes);
  });
  const rng = seededRandom(seed);
  const monteCarloOutcomesByHorizon: Record<ChallengePassRateHorizon["key"], ReplayOutcome[]> = {
    "7d": [],
    "14d": [],
    "30d": [],
    eventual: []
  };

  for (let simulation = 0; simulation < MONTE_CARLO_SIMS; simulation += 1) {
    const sampleTrades = buildMonteCarloTrades(prepared, rng);
    const startMs = sampleTrades[0]?.entryTimeMs ?? prepared[0].entryTimeMs;
    for (const horizon of PASS_RATE_HORIZONS) {
      monteCarloOutcomesByHorizon[horizon.key].push(replayTrades(sampleTrades, startMs, rules, horizon.minutes));
    }
  }
  const monteCarloPassRates = PASS_RATE_HORIZONS.map((horizon) => passRateFromOutcomes(horizon, monteCarloOutcomesByHorizon[horizon.key]));

  return {
    eligibleTrades: prepared.length,
    historicalSessions: starts.length,
    avgTradeGapMinutes: tradeGapMinutes,
    historicalPassRates,
    monteCarloPassRates,
    historical: statsFromOutcomes("historical", historicalOutcomes),
    monteCarlo: statsFromOutcomes("montecarlo", monteCarloOutcomesByHorizon.eventual)
  };
}
