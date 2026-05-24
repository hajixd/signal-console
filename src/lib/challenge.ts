import { TOPSTEP_100K_ACCOUNT, topstepSessionKey } from "./topstep";

export type ChallengeReplayTrade = {
  entryTime: string;
  key?: string;
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

export type ChallengeMonthPassStat = {
  avgFinalPnl: number;
  incompleteCount: number;
  failCount: number;
  key: string;
  label: string;
  medianMinutesToPass: number;
  medianTradesToPass: number;
  monthIndex: number;
  passCount: number;
  passRatePct: number;
  p50FinalPnl: number;
  totalSimulations: number;
};

export type ChallengeStartDayPassStat = {
  avgFinalPnl: number;
  dayIndex: number;
  failCount: number;
  incompleteCount: number;
  key: string;
  label: string;
  medianMinutesToPass: number;
  medianTradesToPass: number;
  passCount: number;
  passRatePct: number;
  p50FinalPnl: number;
  totalSimulations: number;
};

export type ChallengeFailureReasonStat = {
  avgMinutesToFail: number;
  avgTradesToFail: number;
  count: number;
  key: "dailyLoss" | "maxLoss";
  label: string;
  pct: number;
  totalFailures: number;
};

export type ChallengeDistributionBin = {
  count: number;
  key: string;
  label: string;
  pct: number;
};

export type ChallengePassDistribution = {
  daysToPass: ChallengeDistributionBin[];
  tradesToPass: ChallengeDistributionBin[];
};

export type ChallengeRiskSensitivityStat = {
  changePct: number;
  deltaPct: number;
  group: string;
  key: string;
  label: string;
  passCount: number;
  passRatePct: number;
  totalSimulations: number;
};

export type ChallengeWorstStreakStat = {
  dailyStopBreached: boolean;
  endTime: string | null;
  lossDollars: number;
  maxLossCushionDollars: number;
  startTime: string | null;
  survivedMaxLoss: boolean;
  trades: number;
};

export type ChallengeStrategyContributionStat = {
  avgPnlPerRun: number;
  failPnl: number;
  failRuns: number;
  key: string;
  passPnl: number;
  passRuns: number;
  totalPnl: number;
  trades: number;
};

export type ChallengeReplaySummary = {
  eligibleTrades: number;
  historicalSessions: number;
  avgTradeGapMinutes: number;
  failureReasons: ChallengeFailureReasonStat[];
  historicalPassRates: ChallengePassRateHorizon[];
  monthPassStats: ChallengeMonthPassStat[];
  monteCarloPassRates: ChallengePassRateHorizon[];
  passDistribution: ChallengePassDistribution;
  riskSensitivity: ChallengeRiskSensitivityStat[];
  startDayPassStats: ChallengeStartDayPassStat[];
  strategyContributions: ChallengeStrategyContributionStat[];
  worstStreak: ChallengeWorstStreakStat;
  historical: ChallengeMethodStats;
  monteCarlo: ChallengeMethodStats;
};

type PreparedTrade = {
  entryTimeMs: number;
  key: string;
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
  failReason?: "dailyLoss" | "maxLoss";
  pnlByKey: Record<string, number>;
  tradesByKey: Record<string, number>;
};

type ReplayRun = {
  outcome: ReplayOutcome;
  startMs: number;
};

export type ChallengeReplayProgress = {
  completedSimulations?: number;
  progress: number;
  stage: "preparing" | "historical" | "montecarlo" | "summarizing" | "complete";
  totalSimulations?: number;
};

type ChallengeReplayProgressCallback = (progress: ChallengeReplayProgress) => void;

type MonteCarloSource = {
  firstMs: number;
  samples: Array<{ key: string; pnlDollars: number }>;
  startGapsMs: number[];
  templates: SessionTemplate[];
};

const MONTE_CARLO_SIMS = 10_000;
const MINUTES_PER_DAY = 1_440;
const PASS_RATE_HORIZONS = [
  { key: "7d", label: "7 Day Pass Rate", days: 7, minutes: 7 * MINUTES_PER_DAY },
  { key: "14d", label: "14 Day Pass Rate", days: 14, minutes: 14 * MINUTES_PER_DAY },
  { key: "30d", label: "30 Day Pass Rate", days: 30, minutes: 30 * MINUTES_PER_DAY },
  { key: "eventual", label: "Eventual Pass Rate", days: null, minutes: undefined }
] as const;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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
        key: trade.key ?? "unknown",
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

function prepareMonteCarloSource(sourceTrades: PreparedTrade[]): MonteCarloSource {
  const templates = sessionTemplates(sourceTrades);
  return {
    firstMs: templates[0]?.startTimeMs ?? sourceTrades[0]?.entryTimeMs ?? Date.now(),
    samples: sourceTrades.map((trade) => ({ key: trade.key, pnlDollars: trade.pnlDollars })),
    startGapsMs: sessionStartGapsMs(templates),
    templates
  };
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
  const pnlByKey: Record<string, number> = {};
  const tradesByKey: Record<string, number> = {};
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
    pnlByKey[trade.key] = (pnlByKey[trade.key] ?? 0) + trade.pnlDollars;
    tradesByKey[trade.key] = (tradesByKey[trade.key] ?? 0) + 1;
    dailyPnl += trade.pnlDollars;
    balance += trade.pnlDollars;
    endTimeMs = trade.entryTimeMs;

    const maxLossFailed = rules.maximumLossLimit > 0 && balance <= lossFloor;
    const dailyLossFailed = rules.dailyLossLimit > 0 && dailyPnl <= -rules.dailyLossLimit;
    if (maxLossFailed || dailyLossFailed) {
      return {
        status: "fail",
        trades: tradeCount,
        minutes: Math.max(0, (endTimeMs - startMs) / 60_000),
        winRate: tradeCount ? wins / tradeCount : 0,
        finalPnl: balance - rules.startingBalance,
        failReason: maxLossFailed ? "maxLoss" : "dailyLoss",
        pnlByKey,
        tradesByKey
      };
    }

    if (balance - rules.startingBalance >= rules.profitTarget) {
      return {
        status: "pass",
        trades: tradeCount,
        minutes: Math.max(0, (endTimeMs - startMs) / 60_000),
        winRate: tradeCount ? wins / tradeCount : 0,
        finalPnl: balance - rules.startingBalance,
        pnlByKey,
        tradesByKey
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
    finalPnl: balance - rules.startingBalance,
    pnlByKey,
    tradesByKey
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

function monthPassStatsFromRuns(runs: ReplayRun[]): ChallengeMonthPassStat[] {
  const buckets = new Map<number, ReplayOutcome[]>();
  for (const run of runs) {
    const monthIndex = new Date(run.startMs).getUTCMonth();
    if (monthIndex < 0 || monthIndex > 11) continue;
    const bucket = buckets.get(monthIndex) ?? [];
    bucket.push(run.outcome);
    buckets.set(monthIndex, bucket);
  }

  return [...buckets.entries()]
    .map(([monthIndex, outcomes]) => {
      const stats = statsFromOutcomes("historical", outcomes);
      return {
        avgFinalPnl: stats.avgFinalPnl,
        failCount: stats.failCount,
        incompleteCount: stats.incompleteCount,
        key: String(monthIndex + 1).padStart(2, "0"),
        label: MONTH_LABELS[monthIndex],
        medianMinutesToPass: stats.medianMinutesToPass,
        medianTradesToPass: stats.medianTradesToPass,
        monthIndex,
        passCount: stats.passCount,
        passRatePct: stats.passRatePct,
        p50FinalPnl: stats.p50FinalPnl,
        totalSimulations: stats.totalSimulations
      };
    })
    .sort((left, right) => {
      if (right.passRatePct !== left.passRatePct) return right.passRatePct - left.passRatePct;
      if (right.totalSimulations !== left.totalSimulations) return right.totalSimulations - left.totalSimulations;
      if (right.p50FinalPnl !== left.p50FinalPnl) return right.p50FinalPnl - left.p50FinalPnl;
      return left.monthIndex - right.monthIndex;
    });
}

function startDayPassStatsFromRuns(runs: ReplayRun[]): ChallengeStartDayPassStat[] {
  const buckets = new Map<number, ReplayOutcome[]>();
  for (const run of runs) {
    const dayIndex = new Date(run.startMs).getUTCDay();
    if (dayIndex < 0 || dayIndex > 6) continue;
    const bucket = buckets.get(dayIndex) ?? [];
    bucket.push(run.outcome);
    buckets.set(dayIndex, bucket);
  }

  return [...buckets.entries()]
    .map(([dayIndex, outcomes]) => {
      const stats = statsFromOutcomes("historical", outcomes);
      return {
        avgFinalPnl: stats.avgFinalPnl,
        dayIndex,
        failCount: stats.failCount,
        incompleteCount: stats.incompleteCount,
        key: String(dayIndex),
        label: DAY_LABELS[dayIndex],
        medianMinutesToPass: stats.medianMinutesToPass,
        medianTradesToPass: stats.medianTradesToPass,
        passCount: stats.passCount,
        passRatePct: stats.passRatePct,
        p50FinalPnl: stats.p50FinalPnl,
        totalSimulations: stats.totalSimulations
      };
    })
    .sort((left, right) => {
      if (right.passRatePct !== left.passRatePct) return right.passRatePct - left.passRatePct;
      if (right.totalSimulations !== left.totalSimulations) return right.totalSimulations - left.totalSimulations;
      return left.dayIndex - right.dayIndex;
    });
}

function failureReasonsFromOutcomes(outcomes: ReplayOutcome[]): ChallengeFailureReasonStat[] {
  const failures = outcomes.filter((outcome) => outcome.status === "fail");
  const totalFailures = failures.length;
  const reasonLabels: Array<{ key: "dailyLoss" | "maxLoss"; label: string }> = [
    { key: "maxLoss", label: "Max loss" },
    { key: "dailyLoss", label: "Daily loss" }
  ];

  return reasonLabels.map(({ key, label }) => {
    const bucket = failures.filter((outcome) => outcome.failReason === key);
    return {
      avgMinutesToFail: average(bucket.map((outcome) => outcome.minutes)),
      avgTradesToFail: average(bucket.map((outcome) => outcome.trades)),
      count: bucket.length,
      key,
      label,
      pct: totalFailures ? (bucket.length / totalFailures) * 100 : 0,
      totalFailures
    };
  });
}

function distributionBins(values: number[], bins: Array<{ key: string; label: string; max: number }>): ChallengeDistributionBin[] {
  const total = values.length;
  return bins.map((bin, index) => {
    const previousMax = bins[index - 1]?.max ?? -Infinity;
    const count = values.filter((value) => value > previousMax && value <= bin.max).length;
    return {
      count,
      key: bin.key,
      label: bin.label,
      pct: total ? (count / total) * 100 : 0
    };
  });
}

function passDistributionFromRuns(runs: ReplayRun[]): ChallengePassDistribution {
  const passes = runs.map((run) => run.outcome).filter((outcome) => outcome.status === "pass");
  return {
    daysToPass: distributionBins(
      passes.map((outcome) => outcome.minutes / MINUTES_PER_DAY),
      [
        { key: "1d", label: "<= 1d", max: 1 },
        { key: "2d", label: "2d", max: 2 },
        { key: "5d", label: "3-5d", max: 5 },
        { key: "10d", label: "6-10d", max: 10 },
        { key: "more", label: "10d+", max: Infinity }
      ]
    ),
    tradesToPass: distributionBins(
      passes.map((outcome) => outcome.trades),
      [
        { key: "3t", label: "<= 3", max: 3 },
        { key: "6t", label: "4-6", max: 6 },
        { key: "10t", label: "7-10", max: 10 },
        { key: "15t", label: "11-15", max: 15 },
        { key: "more", label: "15+", max: Infinity }
      ]
    )
  };
}

function adjustedRules(rules: ChallengeRules, field: keyof ChallengeRules, changePct: number): ChallengeRules {
  const nextValue = rules[field] * (1 + changePct / 100);
  return {
    ...rules,
    [field]: Math.max(field === "startingBalance" ? 1 : 0, nextValue)
  };
}

function riskSensitivityFromStarts(
  prepared: PreparedTrade[],
  starts: number[],
  rules: ChallengeRules,
  baselinePassRatePct: number
): ChallengeRiskSensitivityStat[] {
  const variants: Array<{ field: keyof ChallengeRules; group: string; label: string }> = [
    { field: "profitTarget", group: "Target", label: "Profit target" },
    { field: "maximumLossLimit", group: "Max loss", label: "Max loss" },
    { field: "dailyLossStop", group: "Daily stop", label: "Daily stop" },
    { field: "dailyProfitLock", group: "Daily lock", label: "Daily lock" }
  ];
  const changes = [-50, -25, -10, 10, 25, 50];

  return variants.flatMap((variant) =>
    changes.map((changePct) => {
      const variantRules = adjustedRules(rules, variant.field, changePct);
      const outcomes = starts.map((startMs) => replayTrades(prepared, startMs, variantRules)).filter((outcome) => outcome.trades > 0);
      const stats = statsFromOutcomes("historical", outcomes);
      return {
        changePct,
        deltaPct: stats.passRatePct - baselinePassRatePct,
        group: variant.group,
        key: `${String(variant.field)}:${changePct}`,
        label: `${variant.label} ${changePct > 0 ? "+" : ""}${changePct}%`,
        passCount: stats.passCount,
        passRatePct: stats.passRatePct,
        totalSimulations: stats.totalSimulations
      };
    })
  );
}

function worstStreakFromTrades(trades: PreparedTrade[], rules: ChallengeRules): ChallengeWorstStreakStat {
  let currentLoss = 0;
  let currentTrades = 0;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let bestLoss = 0;
  let bestTrades = 0;
  let bestStart: number | null = null;
  let bestEnd: number | null = null;

  for (const trade of trades) {
    if (trade.pnlDollars < 0) {
      if (currentTrades === 0) currentStart = trade.entryTimeMs;
      currentTrades += 1;
      currentLoss += Math.abs(trade.pnlDollars);
      currentEnd = trade.entryTimeMs;
      if (currentLoss > bestLoss) {
        bestLoss = currentLoss;
        bestTrades = currentTrades;
        bestStart = currentStart;
        bestEnd = currentEnd;
      }
    } else {
      currentLoss = 0;
      currentTrades = 0;
      currentStart = null;
      currentEnd = null;
    }
  }

  return {
    dailyStopBreached: rules.dailyLossStop > 0 ? bestLoss >= rules.dailyLossStop : false,
    endTime: bestEnd == null ? null : new Date(bestEnd).toISOString(),
    lossDollars: bestLoss,
    maxLossCushionDollars: rules.maximumLossLimit - bestLoss,
    startTime: bestStart == null ? null : new Date(bestStart).toISOString(),
    survivedMaxLoss: rules.maximumLossLimit <= 0 || bestLoss < rules.maximumLossLimit,
    trades: bestTrades
  };
}

function strategyContributionsFromRuns(runs: ReplayRun[]): ChallengeStrategyContributionStat[] {
  const contributions = new Map<string, ChallengeStrategyContributionStat>();
  for (const run of runs) {
    for (const [key, pnl] of Object.entries(run.outcome.pnlByKey)) {
      const current =
        contributions.get(key) ??
        {
          avgPnlPerRun: 0,
          failPnl: 0,
          failRuns: 0,
          key,
          passPnl: 0,
          passRuns: 0,
          totalPnl: 0,
          trades: 0
        };
      current.totalPnl += pnl;
      current.trades += run.outcome.tradesByKey[key] ?? 0;
      if (run.outcome.status === "pass") {
        current.passPnl += pnl;
        current.passRuns += 1;
      }
      if (run.outcome.status === "fail") {
        current.failPnl += pnl;
        current.failRuns += 1;
      }
      contributions.set(key, current);
    }
  }

  return [...contributions.values()]
    .map((entry) => ({
      ...entry,
      avgPnlPerRun: runs.length ? entry.totalPnl / runs.length : 0
    }))
    .sort((left, right) => Math.abs(right.totalPnl) - Math.abs(left.totalPnl))
    .slice(0, 12);
}

function buildMonteCarloTrades(source: MonteCarloSource, rng: () => number): PreparedTrade[] {
  const generated: PreparedTrade[] = [];
  let sessionStartMs = source.firstMs;
  let previousSessionSpanMs = 0;

  for (let sessionIndex = 0; generated.length < source.samples.length; sessionIndex += 1) {
    // Keep Monte Carlo timing grounded in real behavior by resampling historical
    // session shapes and start-to-start gaps instead of inventing a flat daily cadence.
    const template = source.templates[Math.floor(rng() * source.templates.length)] ?? source.templates[0];
    if (!template) break;
    if (sessionIndex > 0) {
      const sampledGapMs = source.startGapsMs[Math.floor(rng() * source.startGapsMs.length)] ?? 86_400_000;
      sessionStartMs += Math.max(sampledGapMs, previousSessionSpanMs + 60_000);
    }
    previousSessionSpanMs = template.spanMs;
    for (const offsetMs of template.tradeOffsetsMs) {
      if (generated.length >= source.samples.length) break;
      const sample = source.samples[Math.floor(rng() * source.samples.length)] ?? { key: "unknown", pnlDollars: 0 };
      generated.push({
        entryTimeMs: sessionStartMs + offsetMs,
        key: sample.key,
        sessionKey: `mc-${sessionIndex}`,
        pnlDollars: sample.pnlDollars
      });
    }
  }

  return generated;
}

export function analyzePropFirmChallenge(
  trades: ChallengeReplayTrade[],
  seed: string,
  rules: ChallengeRules,
  onProgress?: ChallengeReplayProgressCallback
): ChallengeReplaySummary {
  onProgress?.({ progress: 0.03, stage: "preparing" });
  const prepared = prepareTrades(trades);
  const starts = sessionStarts(prepared);
  const tradeGapMinutes = avgTradeGapMinutes(prepared);
  const emptyPassRates = PASS_RATE_HORIZONS.map((horizon) => passRateFromOutcomes(horizon, []));
  const emptyPassDistribution = passDistributionFromRuns([]);

  if (!prepared.length) {
    const empty = statsFromOutcomes("historical", []);
    return {
      eligibleTrades: 0,
      historicalSessions: 0,
      avgTradeGapMinutes: 0,
      failureReasons: failureReasonsFromOutcomes([]),
      historicalPassRates: emptyPassRates,
      monthPassStats: [],
      monteCarloPassRates: emptyPassRates,
      passDistribution: emptyPassDistribution,
      riskSensitivity: [],
      startDayPassStats: [],
      strategyContributions: [],
      worstStreak: worstStreakFromTrades([], rules),
      historical: empty,
      monteCarlo: { ...empty, method: "montecarlo" }
    };
  }

  onProgress?.({ progress: 0.12, stage: "historical" });
  const historicalRuns = starts
    .map((startMs) => ({
      outcome: replayTrades(prepared, startMs, rules),
      startMs
    }))
    .filter((run) => run.outcome.trades > 0);
  const historicalOutcomes = historicalRuns.map((run) => run.outcome);
  const historicalPassRates = PASS_RATE_HORIZONS.map((horizon) => {
    const outcomes =
      horizon.minutes == null
        ? historicalOutcomes
        : starts
            .map((startMs) => replayTrades(prepared, startMs, rules, horizon.minutes))
            .filter((outcome) => outcome.trades > 0);
    return passRateFromOutcomes(horizon, outcomes);
  });
  onProgress?.({ progress: 0.22, stage: "montecarlo", completedSimulations: 0, totalSimulations: MONTE_CARLO_SIMS });
  const rng = seededRandom(seed);
  const monteCarloSource = prepareMonteCarloSource(prepared);
  const monteCarloOutcomesByHorizon: Record<ChallengePassRateHorizon["key"], ReplayOutcome[]> = {
    "7d": [],
    "14d": [],
    "30d": [],
    eventual: []
  };

  for (let simulation = 0; simulation < MONTE_CARLO_SIMS; simulation += 1) {
    const sampleTrades = buildMonteCarloTrades(monteCarloSource, rng);
    const startMs = sampleTrades[0]?.entryTimeMs ?? prepared[0].entryTimeMs;
    for (const horizon of PASS_RATE_HORIZONS) {
      monteCarloOutcomesByHorizon[horizon.key].push(replayTrades(sampleTrades, startMs, rules, horizon.minutes));
    }
    if ((simulation + 1) % 250 === 0 || simulation + 1 === MONTE_CARLO_SIMS) {
      onProgress?.({
        completedSimulations: simulation + 1,
        progress: 0.22 + ((simulation + 1) / MONTE_CARLO_SIMS) * 0.72,
        stage: "montecarlo",
        totalSimulations: MONTE_CARLO_SIMS
      });
    }
  }
  onProgress?.({ progress: 0.96, stage: "summarizing", completedSimulations: MONTE_CARLO_SIMS, totalSimulations: MONTE_CARLO_SIMS });
  const monteCarloPassRates = PASS_RATE_HORIZONS.map((horizon) => passRateFromOutcomes(horizon, monteCarloOutcomesByHorizon[horizon.key]));

  const summary = {
    eligibleTrades: prepared.length,
    historicalSessions: starts.length,
    avgTradeGapMinutes: tradeGapMinutes,
    failureReasons: failureReasonsFromOutcomes(historicalOutcomes),
    historicalPassRates,
    monthPassStats: monthPassStatsFromRuns(historicalRuns),
    monteCarloPassRates,
    passDistribution: passDistributionFromRuns(historicalRuns),
    riskSensitivity: riskSensitivityFromStarts(prepared, starts, rules, statsFromOutcomes("historical", historicalOutcomes).passRatePct),
    startDayPassStats: startDayPassStatsFromRuns(historicalRuns),
    strategyContributions: strategyContributionsFromRuns(historicalRuns),
    worstStreak: worstStreakFromTrades(prepared, rules),
    historical: statsFromOutcomes("historical", historicalOutcomes),
    monteCarlo: statsFromOutcomes("montecarlo", monteCarloOutcomesByHorizon.eventual)
  };
  onProgress?.({ progress: 1, stage: "complete", completedSimulations: MONTE_CARLO_SIMS, totalSimulations: MONTE_CARLO_SIMS });
  return summary;
}
