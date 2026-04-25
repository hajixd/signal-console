"use client";

import { useEffect, useMemo, useState } from "react";
import ChallengeRulesForm from "@/components/challenge/challenge-rules-form";
import {
  strategyContractScale,
  strategyHasContractEdit,
  type StrategyEditOption,
  useStrategyEdits
} from "@/components/strategies/strategy-edits-store";
import {
  analyzePropFirmChallenge,
  DEFAULT_CHALLENGE_RULES,
  type ChallengeMethodStats,
  type ChallengePassRateHorizon,
  type ChallengeReplayTrade,
  type ChallengeRules
} from "@/lib/challenge";

type ChallengeReplayInputTrade = ChallengeReplayTrade & {
  key: string;
};

type ChallengeReplayProps = {
  initialRules: ChallengeRules;
  seedPrefix: string;
  strategies: StrategyEditOption[];
  trades: ChallengeReplayInputTrade[];
};

const STORAGE_KEY = "trading-bot:challenge-rules:v1";

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

export default function ChallengeReplay({ initialRules, seedPrefix, strategies, trades }: ChallengeReplayProps) {
  const [rules, setRules] = useState(() => normalizeRules(initialRules, DEFAULT_CHALLENGE_RULES));
  const edits = useStrategyEdits(strategies);
  const strategyByKey = useMemo(() => new Map(strategies.map((strategy) => [strategy.key, strategy])), [strategies]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setRules(normalizeRules(JSON.parse(raw), initialRules));
    } catch {
      setRules(normalizeRules(initialRules, DEFAULT_CHALLENGE_RULES));
    }
  }, [initialRules]);

  function applyRules(nextRules: ChallengeRules) {
    const normalized = normalizeRules(nextRules, rules);
    setRules(normalized);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Local storage can be unavailable in private contexts; in-memory state still updates.
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

  const challengeReplay = useMemo(
    () => analyzePropFirmChallenge(replayTrades, `${seedPrefix}:${rulesSeed(rules)}`, rules),
    [replayTrades, rules, seedPrefix]
  );

  return (
    <>
      <ChallengeRulesForm key={rulesSeed(rules)} rules={rules} onApply={applyRules} />
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
      </div>
    </>
  );
}
