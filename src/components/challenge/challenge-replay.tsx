"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useAutoTradeAdminMode } from "@/components/auto-trading/use-auto-trade-account-mode";
import ChallengeRulesForm from "@/components/challenge/challenge-rules-form";
import { emitDashboardLoading } from "@/components/ui/dashboard-loading";
import {
  strategyContractScale,
  strategyHasContractEdit,
  type StrategyEditOption,
  type StrategyEditSeedMap,
  useStrategyEdits
} from "@/components/strategies/strategy-edits-store";
import {
  analyzePropFirmChallenge,
  DEFAULT_CHALLENGE_RULES,
  type ChallengeMethodStats,
  type ChallengePassRateHorizon,
  type ChallengeReplayProgress,
  type ChallengeReplaySummary,
  type ChallengeReplayTrade,
  type ChallengeRules
} from "@/lib/challenge";

type ChallengeReplayInputTrade = ChallengeReplayTrade & {
  key: string;
};

type ChallengeReplayProps = {
  initialRules: ChallengeRules;
  loadCachedReplay?: (cacheKey: string) => Promise<ChallengeReplaySummary | null>;
  persistedRules?: boolean;
  persistCachedReplay?: (cacheKey: string, summary: ChallengeReplaySummary) => Promise<void>;
  persistRules?: (rules: ChallengeRules) => Promise<void>;
  seedPrefix: string;
  storageKey?: string;
  strategies: StrategyEditOption[];
  trades: ChallengeReplayInputTrade[];
  persistedStrategyEdits?: StrategyEditSeedMap;
};

const STORAGE_KEY = "trading-bot:challenge-rules:v1";
const REPLAY_CACHE_STORAGE_KEY_PREFIX = "trading-bot:challenge-replay-cache:v2";
const REPLAY_CACHE_INDEX_KEY = "trading-bot:challenge-replay-cache:index:v2";
const REPLAY_CACHE_LIMIT = 20;
const REPLAY_CACHE_VERSION = "mc-10000-v1";

function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return "inf";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function fmtPct(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value)}%`;
}

function fmtMoney(value: number, signed = false): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  });
  const formatted = formatter.format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

function fmtChallengeDuration(minutesValue: number): string {
  if (!Number.isFinite(minutesValue) || minutesValue <= 0) return "--";
  let remaining = Math.round(minutesValue);
  const weeks = Math.floor(remaining / 10_080);
  remaining -= weeks * 10_080;
  const days = Math.floor(remaining / 1_440);
  remaining -= days * 1_440;
  const hours = Math.floor(remaining / 60);
  const minutes = remaining - hours * 60;
  const parts: string[] = [];
  if (weeks) parts.push(`${weeks}w`);
  if (days) parts.push(`${days}d`);
  if (hours && parts.length < 2) parts.push(`${hours}h`);
  if (!parts.length || (minutes && parts.length < 2)) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function resultClass(value: number): string {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "neutral";
}

function challengeTone(stats: ChallengeMethodStats): string {
  if (!stats.totalSimulations) return "tone-neutral";
  if (stats.passRatePct >= 50) return "tone-up";
  if (stats.passCount > 0) return "tone-neutral";
  return "tone-down";
}

function passRateTone(rate: ChallengePassRateHorizon): string {
  if (!rate.totalSimulations) return "tone-neutral";
  if (rate.passRatePct >= 70) return "tone-up";
  if (rate.passRatePct >= 50 || rate.passCount > 0) return "tone-neutral";
  return "tone-down";
}

function ChallengePassRateStrip({ rates }: { rates: ChallengePassRateHorizon[] }) {
  return (
    <div className="challenge-pass-rates">
      {rates.map((rate) => (
        <div className={`challenge-pass-card ${passRateTone(rate)}`} key={rate.key}>
          <span>{rate.label}</span>
          <strong>{rate.totalSimulations ? fmtPct(rate.passRatePct) : "--"}</strong>
          <small>
            {fmtNumber(rate.passCount)} / {fmtNumber(rate.totalSimulations)} passed
          </small>
        </div>
      ))}
    </div>
  );
}

function ChallengeReplayPanel({
  title,
  stats,
  rates
}: {
  title: string;
  stats: ChallengeMethodStats;
  rates: ChallengePassRateHorizon[];
}) {
  const hasPasses = stats.passCount > 0;
  return (
    <div className={`challenge-method ${challengeTone(stats)}`}>
      <div className="challenge-method-head">
        <span>{title}</span>
        <strong>{stats.totalSimulations ? fmtPct(stats.passRatePct) : "--"}</strong>
      </div>
      <div className="challenge-progress-track" aria-hidden="true">
        <div className={stats.passRatePct >= 50 ? "up" : "down"} style={{ width: `${Math.max(0, Math.min(100, stats.passRatePct))}%` }} />
      </div>
      <ChallengePassRateStrip rates={rates} />
      <div className="challenge-method-grid">
        <div>
          <span>Avg pass time</span>
          <strong className={hasPasses ? "up" : "down"}>{hasPasses ? fmtChallengeDuration(stats.avgMinutesToPass) : "No pass"}</strong>
        </div>
        <div>
          <span>Median pass time</span>
          <strong className={hasPasses ? "up" : "down"}>{hasPasses ? fmtChallengeDuration(stats.medianMinutesToPass) : "No pass"}</strong>
        </div>
        <div>
          <span>Avg trades to pass</span>
          <strong>{hasPasses ? fmtNumber(stats.avgTradesToPass) : "--"}</strong>
        </div>
        <div>
          <span>Median trades to pass</span>
          <strong>{hasPasses ? fmtNumber(stats.medianTradesToPass) : "--"}</strong>
        </div>
        <div>
          <span>Pass / fail / open</span>
          <strong>
            {fmtNumber(stats.passCount)} / {fmtNumber(stats.failCount)} / {fmtNumber(stats.incompleteCount)}
          </strong>
        </div>
        <div>
          <span>P50 final P&L</span>
          <strong className={resultClass(stats.p50FinalPnl)}>{fmtMoney(stats.p50FinalPnl, true)}</strong>
        </div>
      </div>
    </div>
  );
}

function normalizedNumber(value: unknown, fallback: number, min = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
}

function normalizeRules(value: unknown, fallback: ChallengeRules): ChallengeRules {
  const source = typeof value === "object" && value !== null ? (value as Partial<ChallengeRules>) : {};
  return {
    startingBalance: normalizedNumber(source.startingBalance, fallback.startingBalance, 1),
    profitTarget: normalizedNumber(source.profitTarget, fallback.profitTarget, 1),
    maximumLossLimit: normalizedNumber(source.maximumLossLimit, fallback.maximumLossLimit),
    dailyLossLimit: normalizedNumber(source.dailyLossLimit, fallback.dailyLossLimit),
    dailyProfitLock: normalizedNumber(source.dailyProfitLock, fallback.dailyProfitLock),
    dailyLossStop: normalizedNumber(source.dailyLossStop, fallback.dailyLossStop)
  };
}

function rulesSeed(rules: ChallengeRules): string {
  return [
    rules.startingBalance,
    rules.profitTarget,
    rules.maximumLossLimit,
    rules.dailyLossLimit,
    rules.dailyProfitLock,
    rules.dailyLossStop
  ].join("|");
}

function emptyChallengeReplaySummary(): ChallengeReplaySummary {
  return analyzePropFirmChallenge([], "empty", DEFAULT_CHALLENGE_RULES);
}

function hashString(value: string): string {
  let first = 0xdeadbeef ^ value.length;
  let second = 0x41c6ce57 ^ value.length;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }

  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);

  return `${(second >>> 0).toString(36)}${(first >>> 0).toString(36)}`;
}

function challengeReplayCachePayload(seedPrefix: string, rules: ChallengeRules, trades: ChallengeReplayTrade[]): string {
  return JSON.stringify({
    rules,
    seedPrefix,
    trades: trades.map((trade) => [trade.entryTime, Math.round(trade.pnlDollars * 10_000) / 10_000]),
    version: REPLAY_CACHE_VERSION
  });
}

function challengeReplayCacheKey(seedPrefix: string, rules: ChallengeRules, trades: ChallengeReplayTrade[]): string {
  const payload = challengeReplayCachePayload(seedPrefix, rules, trades);
  return `cr-${hashString(payload)}-${payload.length.toString(36)}-${trades.length.toString(36)}`;
}

function isChallengeReplaySummary(value: unknown): value is ChallengeReplaySummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<ChallengeReplaySummary>;
  return (
    typeof summary.eligibleTrades === "number" &&
    typeof summary.historicalSessions === "number" &&
    Boolean(summary.historical && typeof summary.historical === "object") &&
    Boolean(summary.monteCarlo && typeof summary.monteCarlo === "object") &&
    Array.isArray(summary.historicalPassRates) &&
    Array.isArray(summary.monteCarloPassRates)
  );
}

function readLocalReplayCache(cacheKey: string): ChallengeReplaySummary | null {
  try {
    const raw = window.localStorage.getItem(`${REPLAY_CACHE_STORAGE_KEY_PREFIX}:${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { summary?: unknown; version?: unknown };
    if (parsed.version !== REPLAY_CACHE_VERSION || !isChallengeReplaySummary(parsed.summary)) return null;
    return parsed.summary;
  } catch {
    return null;
  }
}

function writeLocalReplayCache(cacheKey: string, summary: ChallengeReplaySummary): void {
  try {
    const now = Date.now();
    const rawIndex = window.localStorage.getItem(REPLAY_CACHE_INDEX_KEY);
    const parsedIndex = rawIndex ? JSON.parse(rawIndex) : [];
    const index: Array<{ key?: unknown; updatedAt?: unknown }> = Array.isArray(parsedIndex)
      ? parsedIndex.filter((entry): entry is { key?: unknown; updatedAt?: unknown } => Boolean(entry && typeof entry === "object"))
      : [];
    const nextIndex = [
      { key: cacheKey, updatedAt: now },
      ...index.filter((entry) => entry.key !== cacheKey)
    ].slice(0, REPLAY_CACHE_LIMIT);
    const retainedKeys = new Set(nextIndex.map((entry) => entry.key).filter((key): key is string => typeof key === "string"));

    window.localStorage.setItem(
      `${REPLAY_CACHE_STORAGE_KEY_PREFIX}:${cacheKey}`,
      JSON.stringify({
        summary,
        updatedAt: new Date(now).toISOString(),
        version: REPLAY_CACHE_VERSION
      })
    );

    for (const entry of index) {
      if (typeof entry.key === "string" && !retainedKeys.has(entry.key)) {
        window.localStorage.removeItem(`${REPLAY_CACHE_STORAGE_KEY_PREFIX}:${entry.key}`);
      }
    }

    window.localStorage.setItem(REPLAY_CACHE_INDEX_KEY, JSON.stringify(nextIndex));
  } catch {
    // The replay cache is an optimization; calculation still works if storage is full or unavailable.
  }
}

function replayProgressLabel(progress: ChallengeReplayProgress | null): string {
  if (!progress) return "Recalculating challenge replay";
  if (progress.stage === "historical") return "Checking historical replay";
  if (progress.stage === "montecarlo") {
    const completed = progress.completedSimulations ?? 0;
    const total = progress.totalSimulations ?? 0;
    return total ? `Monte Carlo ${fmtNumber(completed)} / ${fmtNumber(total)}` : "Running Monte Carlo";
  }
  if (progress.stage === "summarizing") return "Summarizing challenge replay";
  if (progress.stage === "complete") return "Challenge replay ready";
  return "Preparing challenge replay";
}

export default function ChallengeReplay({
  initialRules,
  loadCachedReplay,
  persistedRules = false,
  persistCachedReplay,
  persistRules,
  seedPrefix,
  storageKey,
  strategies,
  trades,
  persistedStrategyEdits
}: ChallengeReplayProps) {
  const [rules, setRules] = useState(() => normalizeRules(initialRules, DEFAULT_CHALLENGE_RULES));
  const [challengeReplay, setChallengeReplay] = useState<ChallengeReplaySummary>(() => emptyChallengeReplaySummary());
  const [isRecalculating, setIsRecalculating] = useState(true);
  const [replayProgress, setReplayProgress] = useState<ChallengeReplayProgress | null>(null);
  const [, startSavingRules] = useTransition();
  const isRestricted = !useAutoTradeAdminMode();
  const edits = useStrategyEdits(strategies, persistedStrategyEdits);
  const strategyByKey = useMemo(() => new Map(strategies.map((strategy) => [strategy.key, strategy])), [strategies]);
  const rulesStorageKey = storageKey ?? STORAGE_KEY;

  useEffect(() => {
    if (persistedRules) {
      setRules(normalizeRules(initialRules, DEFAULT_CHALLENGE_RULES));
      return;
    }

    try {
      const raw = window.localStorage.getItem(rulesStorageKey);
      setRules(raw ? normalizeRules(JSON.parse(raw), initialRules) : normalizeRules(initialRules, DEFAULT_CHALLENGE_RULES));
    } catch {
      setRules(normalizeRules(initialRules, DEFAULT_CHALLENGE_RULES));
    }
  }, [initialRules, persistedRules, rulesStorageKey]);

  function applyRules(nextRules: ChallengeRules) {
    if (isRestricted) return;
    const normalized = normalizeRules(nextRules, rules);
    setRules(normalized);
    try {
      window.localStorage.setItem(rulesStorageKey, JSON.stringify(normalized));
    } catch {
      // Local storage can be unavailable in private contexts; in-memory state still updates.
    }
    if (persistRules) {
      startSavingRules(() => {
        void persistRules(normalized).catch((error) => console.error("Failed to save challenge rules", error));
      });
    }
  }

  const replayTrades = useMemo(() => {
    const initialBalance = Math.max(1, initialRules.startingBalance);
    const accountScale = rules.startingBalance / initialBalance;
    return trades.map((trade) => ({
      entryTime: trade.entryTime,
      pnlDollars: (() => {
        const strategy = strategyByKey.get(trade.key);
        if (!strategy) return trade.pnlDollars * accountScale;
        const contractScale = strategyContractScale(strategy, edits);
        const challengeAccountScale = strategyHasContractEdit(strategy, edits) ? 1 : accountScale;
        return trade.pnlDollars * contractScale * challengeAccountScale;
      })()
    }));
  }, [edits, initialRules.startingBalance, rules.startingBalance, strategyByKey, trades]);
  const replayCacheKey = useMemo(() => challengeReplayCacheKey(seedPrefix, rules, replayTrades), [replayTrades, rules, seedPrefix]);

  useEffect(() => {
    emitDashboardLoading("challenge-replay", {
      active: isRecalculating,
      label: replayProgressLabel(replayProgress),
      progress: replayProgress?.progress ?? 0.04
    });
    return () => emitDashboardLoading("challenge-replay", false);
  }, [isRecalculating, replayProgress]);

  useEffect(() => {
    let cancelled = false;
    let worker: Worker | null = null;
    const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const seed = `${seedPrefix}:${rulesSeed(rules)}`;
    const localCached = readLocalReplayCache(replayCacheKey);

    if (localCached) {
      setChallengeReplay(localCached);
      setReplayProgress({ progress: 1, stage: "complete" });
      setIsRecalculating(false);
      return () => {
        cancelled = true;
      };
    }

    setIsRecalculating(true);
    setReplayProgress({ progress: 0.04, stage: "preparing" });

    const finish = (summary: ChallengeReplaySummary, persist = true) => {
      if (cancelled) return;
      setChallengeReplay(summary);
      setReplayProgress({ progress: 1, stage: "complete" });
      setIsRecalculating(false);
      writeLocalReplayCache(replayCacheKey, summary);
      if (!isRestricted && persistCachedReplay && persist) {
        void persistCachedReplay(replayCacheKey, summary).catch((error) => console.error("Failed to save challenge replay cache", error));
      }
    };

    const calculate = () => {
      try {
        worker = new Worker(new URL("./challenge-replay-worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<{ id: string; progress?: ChallengeReplayProgress; summary?: ChallengeReplaySummary }>) => {
          if (event.data.id !== id) return;
          if (event.data.progress && !cancelled) {
            setReplayProgress(event.data.progress);
          }
          if (!event.data.summary) return;
          const summary = event.data.summary;
          worker?.terminate();
          worker = null;
          finish(summary);
        };
        worker.onerror = (event) => {
          console.error("Challenge replay worker failed", event.message);
          worker?.terminate();
          worker = null;
          finish(analyzePropFirmChallenge(replayTrades, seed, rules, setReplayProgress));
        };
        worker.postMessage({ id, rules, seed, trades: replayTrades });
      } catch (error) {
        console.error("Challenge replay worker unavailable", error);
        finish(analyzePropFirmChallenge(replayTrades, seed, rules, setReplayProgress));
      }
    };

    const loadOrCalculate = async () => {
      if (loadCachedReplay) {
        try {
          setReplayProgress({ progress: 0.08, stage: "preparing" });
          const remoteCached = await loadCachedReplay(replayCacheKey);
          if (cancelled) return;
          if (remoteCached) {
            finish(remoteCached, false);
            return;
          }
        } catch (error) {
          console.error("Failed to load challenge replay cache", error);
        }
      }

      if (!cancelled) calculate();
    };

    void loadOrCalculate();

    return () => {
      cancelled = true;
      worker?.terminate();
      worker = null;
    };
  }, [isRestricted, loadCachedReplay, persistCachedReplay, replayCacheKey, replayTrades, rules, seedPrefix]);

  return (
    <div className={`challengeReplay${isRestricted ? " adminOnlyRestrictedSurface" : ""}`} aria-disabled={isRestricted}>
      <ChallengeRulesForm key={rulesSeed(rules)} readOnly={isRestricted} rules={rules} onApply={applyRules} />
      <div className="challenge-grid">
        <ChallengeReplayPanel title="Historical" stats={challengeReplay.historical} rates={challengeReplay.historicalPassRates} />
        <ChallengeReplayPanel title="Monte Carlo" stats={challengeReplay.monteCarlo} rates={challengeReplay.monteCarloPassRates} />
      </div>
      <div className="challenge-footnote">
        <span>Avg gap: {fmtChallengeDuration(challengeReplay.avgTradeGapMinutes)}</span>
        <span>Account: {fmtMoney(rules.startingBalance)}</span>
        <span>Target: {fmtMoney(rules.profitTarget)}</span>
        <span>Daily lock: {fmtMoney(rules.dailyProfitLock)}</span>
        <span>Daily stop: {fmtMoney(rules.dailyLossStop)}</span>
        {isRecalculating ? <span>Monte Carlo: calculating</span> : null}
      </div>
    </div>
  );
}
