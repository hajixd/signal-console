"use client";

import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";
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
  type ChallengeDistributionBin,
  type ChallengeFailureReasonStat,
  type ChallengeMethodStats,
  type ChallengeMonthPassStat,
  type ChallengePassRateHorizon,
  type ChallengeReplayProgress,
  type ChallengeReplaySummary,
  type ChallengeReplayTrade,
  type ChallengeRiskSensitivityStat,
  type ChallengeRules,
  type ChallengeStartDayPassStat,
  type ChallengeStrategyContributionStat,
  type ChallengeWorstStreakStat
} from "@/lib/challenge";

type ChallengeReplayInputTrade = ChallengeReplayTrade & {
  key: string;
  lockedSize?: boolean;
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
const REPLAY_CACHE_VERSION = "mc-10000-insights-v2";

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

function passRateTone(rate: Pick<ChallengePassRateHorizon, "passCount" | "passRatePct" | "totalSimulations">): string {
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
        <div>
          <span>Avg fail time</span>
          <strong className={stats.failCount ? "down" : "up"}>{stats.failCount ? fmtChallengeDuration(stats.avgMinutesToFail) : "No fail"}</strong>
        </div>
        <div>
          <span>Avg trades to fail</span>
          <strong>{stats.failCount ? fmtNumber(stats.avgTradesToFail) : "--"}</strong>
        </div>
        <div>
          <span>Avg pass win rate</span>
          <strong>{hasPasses ? fmtPct(stats.avgWinRatePassPct) : "--"}</strong>
        </div>
        <div>
          <span>Avg final P&L</span>
          <strong className={resultClass(stats.avgFinalPnl)}>{stats.totalSimulations ? fmtMoney(stats.avgFinalPnl, true) : "--"}</strong>
        </div>
        <div>
          <span>P10 final P&L</span>
          <strong className={resultClass(stats.p10FinalPnl)}>{stats.totalSimulations ? fmtMoney(stats.p10FinalPnl, true) : "--"}</strong>
        </div>
        <div>
          <span>P90 final P&L</span>
          <strong className={resultClass(stats.p90FinalPnl)}>{stats.totalSimulations ? fmtMoney(stats.p90FinalPnl, true) : "--"}</strong>
        </div>
      </div>
    </div>
  );
}

type InsightViewKey = "months" | "endingMonths" | "failures" | "pace" | "sensitivity" | "distribution" | "streak" | "strategies" | "confidence" | "launch";

const INSIGHT_VIEW_ORDER: InsightViewKey[] = [
  "months",
  "endingMonths",
  "failures",
  "pace",
  "sensitivity",
  "distribution",
  "streak",
  "strategies",
  "confidence",
  "launch"
];

function sampleConfidence(total: number): { className: string; label: string } {
  if (total >= 80) return { className: "tone-up", label: "High sample" };
  if (total >= 40) return { className: "tone-neutral", label: "Medium sample" };
  return { className: "tone-down", label: "Low sample" };
}

function monthLabelFromIndex(monthIndex: number | null): string {
  if (monthIndex == null) return "Current";
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, monthIndex, 1)));
}

function bestSummary<T extends { label: string; passRatePct: number }>(items: T[], fallback = "--"): string {
  const best = items[0];
  return best ? `${best.label} ${fmtPct(best.passRatePct)}` : fallback;
}

function maxPct(values: number[]): number {
  return Math.max(1, ...values.map((value) => Math.abs(value)).filter(Number.isFinite));
}

function InsightBar({ pct, tone = "tone-neutral" }: { pct: number; tone?: string }) {
  return (
    <div className={`challenge-insight-track ${tone}`} aria-hidden="true">
      <span style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </div>
  );
}

function MonthRows({ currentMonthIndex, months }: { currentMonthIndex: number | null; months: ChallengeMonthPassStat[] }) {
  return (
    <div className="challenge-insight-list">
      {months.map((month, index) => {
        const confidence = sampleConfidence(month.totalSimulations);
        return (
          <div className={`challenge-insight-row ${passRateTone(month)}${month.monthIndex === currentMonthIndex ? " is-current" : ""}`} key={month.key}>
            <span className="challenge-insight-rank">#{index + 1}</span>
            <strong className="challenge-insight-name">{month.label}</strong>
            <InsightBar pct={month.passRatePct} tone={passRateTone(month)} />
            <strong className="challenge-insight-rate">{fmtPct(month.passRatePct)}</strong>
            <small>
              {fmtNumber(month.passCount)} / {fmtNumber(month.totalSimulations)} passed
            </small>
            <small>Median pass {month.passCount ? fmtChallengeDuration(month.medianMinutesToPass) : "--"}</small>
            <small className={confidence.className}>{confidence.label}</small>
          </div>
        );
      })}
    </div>
  );
}

function EndingMonthRows({ currentMonthIndex, months }: { currentMonthIndex: number | null; months: ChallengeMonthPassStat[] }) {
  return (
    <div className="challenge-insight-list">
      {months.map((month, index) => (
        <div className={`challenge-insight-row ${passRateTone(month)}${month.monthIndex === currentMonthIndex ? " is-current" : ""}`} key={month.key}>
          <span className="challenge-insight-rank">#{index + 1}</span>
          <strong className="challenge-insight-name">{month.label}</strong>
          <InsightBar pct={month.passRatePct} tone={passRateTone(month)} />
          <strong className="challenge-insight-rate">{fmtPct(month.passRatePct)}</strong>
          <small>
            {fmtNumber(month.passCount)} / {fmtNumber(month.totalSimulations)} passed
          </small>
          <small>Median pass {month.passCount ? fmtChallengeDuration(month.medianMinutesToPass) : "--"}</small>
          <small>P50 final {month.totalSimulations ? fmtMoney(month.p50FinalPnl, true) : "--"}</small>
        </div>
      ))}
    </div>
  );
}

function FailureChart({ reasons }: { reasons: ChallengeFailureReasonStat[] }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const maxCount = maxPct(reasons.map((reason) => reason.count));
  const activeReason = reasons.find((reason) => reason.key === activeKey) ?? [...reasons].sort((left, right) => right.count - left.count)[0];

  return (
    <div className="challenge-failure-chart">
      <div className="challenge-failure-bars" aria-label="Failure reason chart">
        {reasons.map((reason) => (
          <button
            aria-label={`${reason.label} failure reason`}
            className={`challenge-failure-bar ${activeReason?.key === reason.key ? "is-active" : ""}`}
            key={reason.key}
            onClick={() => setActiveKey(reason.key)}
            onFocus={() => setActiveKey(reason.key)}
            onPointerEnter={() => setActiveKey(reason.key)}
            style={{ "--bar-height": `${Math.max(reason.count ? 10 : 3, (reason.count / maxCount) * 100)}%` } as CSSProperties}
            type="button"
          >
            <span className="challenge-failure-bar-rail">
              <span />
            </span>
            <strong>{reason.totalFailures ? fmtPct(reason.pct) : "--"}</strong>
            <small>{reason.label}</small>
          </button>
        ))}
      </div>
      <div className="challenge-failure-detail tone-down">
        <span>{activeReason?.label ?? "Failure reason"}</span>
        <strong>{activeReason?.totalFailures ? `${fmtNumber(activeReason.count)} fails` : "--"}</strong>
        <small>{activeReason?.totalFailures ? `${fmtPct(activeReason.pct)} of failed starts` : "No failed starts"}</small>
        <small>Avg fail {activeReason?.count ? fmtChallengeDuration(activeReason.avgMinutesToFail) : "--"}</small>
        <small>{activeReason?.count ? `${fmtNumber(activeReason.avgTradesToFail)} trades before fail` : "--"}</small>
      </div>
    </div>
  );
}

function PaceDistribution({ summary }: { summary: ChallengeReplaySummary }) {
  const [mode, setMode] = useState<"days" | "trades">("days");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const bins = mode === "days" ? summary.passDistribution.daysToPass : summary.passDistribution.tradesToPass;
  const activeBin = bins.find((bin) => bin.key === activeKey) ?? [...bins].sort((left, right) => right.count - left.count)[0];
  const maxBinPct = maxPct(bins.map((bin) => bin.pct));

  return (
    <div className="challenge-pace-distribution">
      <div className="challenge-pace-stat-grid">
        <div className="challenge-pace-stat tone-up">
          <span>Historical median pass</span>
          <strong>{summary.historical.passCount ? fmtChallengeDuration(summary.historical.medianMinutesToPass) : "--"}</strong>
          <small>{summary.historical.passCount ? `${fmtNumber(summary.historical.medianTradesToPass)} trades` : "No historical pass"}</small>
        </div>
        <div className="challenge-pace-stat tone-up">
          <span>Monte Carlo median pass</span>
          <strong>{summary.monteCarlo.passCount ? fmtChallengeDuration(summary.monteCarlo.medianMinutesToPass) : "--"}</strong>
          <small>{summary.monteCarlo.passCount ? `${fmtNumber(summary.monteCarlo.medianTradesToPass)} trades` : "No simulated pass"}</small>
        </div>
        <div className="challenge-pace-stat tone-neutral">
          <span>Expected final P&L</span>
          <strong className={resultClass(summary.monteCarlo.avgFinalPnl)}>{summary.monteCarlo.totalSimulations ? fmtMoney(summary.monteCarlo.avgFinalPnl, true) : "--"}</strong>
          <small>Monte Carlo average</small>
        </div>
      </div>
      <div className="challenge-pace-chart">
        <div className="challenge-pace-chart-head">
          <div>
            <span>{mode === "days" ? "Time to pass" : "Trades to pass"}</span>
            <strong>{activeBin ? `${activeBin.label} ${fmtPct(activeBin.pct)}` : "--"}</strong>
          </div>
          <div className="challenge-mode-tabs" aria-label="Pace distribution mode">
            <button className={mode === "days" ? "is-active" : ""} onClick={() => setMode("days")} type="button">
              Days
            </button>
            <button className={mode === "trades" ? "is-active" : ""} onClick={() => setMode("trades")} type="button">
              Trades
            </button>
          </div>
        </div>
        <div className="challenge-pace-bars">
          {bins.map((bin) => (
            <button
              aria-label={`${bin.label} pace bucket`}
              className={`challenge-pace-bin ${activeBin?.key === bin.key ? "is-active" : ""}`}
              key={bin.key}
              onClick={() => setActiveKey(bin.key)}
              onFocus={() => setActiveKey(bin.key)}
              onPointerEnter={() => setActiveKey(bin.key)}
              type="button"
            >
              <span>{bin.label}</span>
              <div aria-hidden="true">
                <span style={{ width: `${Math.max(bin.pct ? 5 : 2, (bin.pct / maxBinPct) * 100)}%` }} />
              </div>
              <strong>{fmtPct(bin.pct)}</strong>
              <small>{fmtNumber(bin.count)} passes</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RiskHeatmap({ rows }: { rows: ChallengeRiskSensitivityStat[] }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const changes = useMemo(() => [...new Set(rows.map((row) => row.changePct))].sort((left, right) => left - right), [rows]);
  const groups = useMemo(() => [...new Set(rows.map((row) => row.group))], [rows]);
  const maxDelta = maxPct(rows.map((row) => row.deltaPct));
  const activeRow = rows.find((row) => row.key === activeKey) ?? [...rows].sort((left, right) => Math.abs(right.deltaPct) - Math.abs(left.deltaPct))[0];

  return (
    <div className="challenge-risk-heatmap-shell">
      <div className={`challenge-risk-detail ${activeRow && activeRow.deltaPct >= 0 ? "tone-up" : "tone-down"}`}>
        <span>{activeRow?.label ?? "Rule change"}</span>
        <strong>{activeRow ? fmtPct(activeRow.passRatePct) : "--"}</strong>
        <small className={activeRow && activeRow.deltaPct >= 0 ? "up" : "down"}>
          {activeRow ? `${activeRow.deltaPct >= 0 ? "+" : ""}${fmtPct(activeRow.deltaPct)} vs current rules` : "--"}
        </small>
        <small>{activeRow ? `${fmtNumber(activeRow.passCount)} / ${fmtNumber(activeRow.totalSimulations)} passed` : "--"}</small>
      </div>
      <div className="challenge-risk-heatmap" aria-label="Risk rule sensitivity heatmap">
        <div className="challenge-risk-heatmap-head">
          <span>Rule</span>
          {changes.map((change) => (
            <strong key={change}>{change > 0 ? "+" : ""}{fmtNumber(change)}%</strong>
          ))}
        </div>
        {groups.map((group) => (
          <div className="challenge-risk-heatmap-row" key={group}>
            <span>{group}</span>
            {changes.map((change) => {
              const row = rows.find((entry) => entry.group === group && entry.changePct === change);
              const heatAlpha = row ? 0.16 + Math.min(0.72, (Math.abs(row.deltaPct) / maxDelta) * 0.72) : 0.08;
              return (
                <button
                  aria-label={row ? row.label : `${group} ${change}%`}
                  className={`challenge-heatmap-cell ${row && row.deltaPct >= 0 ? "is-up" : "is-down"}${activeRow?.key === row?.key ? " is-active" : ""}`}
                  disabled={!row}
                  key={`${group}:${change}`}
                  onClick={() => row && setActiveKey(row.key)}
                  onFocus={() => row && setActiveKey(row.key)}
                  onPointerEnter={() => row && setActiveKey(row.key)}
                  style={{ "--heat-alpha": heatAlpha.toFixed(3) } as CSSProperties}
                  type="button"
                >
                  <strong>{row ? fmtPct(row.passRatePct) : "--"}</strong>
                  <small>{row ? `${row.deltaPct >= 0 ? "+" : ""}${fmtPct(row.deltaPct)}` : "--"}</small>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DistributionRows({ bins, title }: { bins: ChallengeDistributionBin[]; title: string }) {
  return (
    <div className="challenge-distribution-group">
      <strong>{title}</strong>
      <div className="challenge-insight-list compact">
        {bins.map((bin) => (
          <div className="challenge-insight-row compact tone-neutral" key={bin.key}>
            <span className="challenge-insight-rank">{bin.label}</span>
            <InsightBar pct={bin.pct} />
            <strong className="challenge-insight-rate">{fmtPct(bin.pct)}</strong>
            <small>{fmtNumber(bin.count)} passes</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function DistributionView({ summary }: { summary: ChallengeReplaySummary }) {
  return (
    <div className="challenge-distribution-grid">
      <DistributionRows bins={summary.passDistribution.daysToPass} title="Days to pass" />
      <DistributionRows bins={summary.passDistribution.tradesToPass} title="Trades to pass" />
    </div>
  );
}

function StreakCards({ streak }: { streak: ChallengeWorstStreakStat }) {
  return (
    <div className="challenge-insight-card-grid">
      <div className={`challenge-insight-card ${streak.survivedMaxLoss ? "tone-up" : "tone-down"}`}>
        <span>Worst losing streak</span>
        <strong>{fmtNumber(streak.trades)} trades</strong>
        <small>{fmtMoney(-streak.lossDollars)} drawdown</small>
      </div>
      <div className={`challenge-insight-card ${streak.maxLossCushionDollars > 0 ? "tone-up" : "tone-down"}`}>
        <span>Max loss cushion</span>
        <strong>{fmtMoney(streak.maxLossCushionDollars, true)}</strong>
        <small>{streak.survivedMaxLoss ? "Survives max loss" : "Breaches max loss"}</small>
      </div>
      <div className={`challenge-insight-card ${streak.dailyStopBreached ? "tone-down" : "tone-up"}`}>
        <span>Daily stop stress</span>
        <strong>{streak.dailyStopBreached ? "Breached" : "Survived"}</strong>
        <small>Assumes the streak lands in one session</small>
      </div>
      <div className="challenge-insight-card tone-neutral">
        <span>Streak window</span>
        <strong>{streak.startTime ? fmtChallengeDuration((Date.parse(streak.endTime ?? streak.startTime) - Date.parse(streak.startTime)) / 60_000) : "--"}</strong>
        <small>{streak.startTime ? new Date(streak.startTime).toLocaleDateString() : "No loss streak"}</small>
      </div>
    </div>
  );
}

function StrategyContributionRows({
  labels,
  rows
}: {
  labels: Map<string, string>;
  rows: ChallengeStrategyContributionStat[];
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeRow = rows.find((row) => row.key === activeKey) ?? rows[0];
  const maxImpact = maxPct(rows.map((row) => row.totalPnl));

  return (
    <div className="challenge-strategy-distribution">
      <div className={`challenge-strategy-detail ${activeRow && activeRow.totalPnl >= 0 ? "tone-up" : "tone-down"}`}>
        <span>{activeRow ? labels.get(activeRow.key) ?? activeRow.key : "Strategy"}</span>
        <strong className={activeRow ? resultClass(activeRow.totalPnl) : "neutral"}>{activeRow ? fmtMoney(activeRow.totalPnl, true) : "--"}</strong>
        <small>{activeRow ? `${fmtMoney(activeRow.avgPnlPerRun, true)} avg per replay start` : "--"}</small>
        <small>{activeRow ? `${fmtNumber(activeRow.passRuns)} pass runs / ${fmtNumber(activeRow.failRuns)} fail runs` : "--"}</small>
      </div>
      <div className="challenge-strategy-impact-list" aria-label="Strategy contribution distribution">
        {rows.map((row, index) => (
          <button
            aria-label={`${labels.get(row.key) ?? row.key} strategy impact`}
            className={`challenge-strategy-impact ${row.totalPnl >= 0 ? "tone-up" : "tone-down"}${activeRow?.key === row.key ? " is-active" : ""}`}
            key={row.key}
            onClick={() => setActiveKey(row.key)}
            onFocus={() => setActiveKey(row.key)}
            onPointerEnter={() => setActiveKey(row.key)}
            type="button"
          >
            <span>#{index + 1}</span>
            <strong>{labels.get(row.key) ?? row.key}</strong>
            <div aria-hidden="true">
              <span style={{ width: `${Math.max(4, (Math.abs(row.totalPnl) / maxImpact) * 100)}%` }} />
            </div>
            <small className={resultClass(row.totalPnl)}>{fmtMoney(row.totalPnl, true)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function ConfidenceRows({ currentMonthIndex, months }: { currentMonthIndex: number | null; months: ChallengeMonthPassStat[] }) {
  return (
    <div className="challenge-insight-list">
      {months.map((month) => {
        const confidence = sampleConfidence(month.totalSimulations);
        return (
          <div className={`challenge-insight-row ${confidence.className}${month.monthIndex === currentMonthIndex ? " is-current" : ""}`} key={month.key}>
            <span className="challenge-insight-rank">{month.label}</span>
            <strong className="challenge-insight-name">{confidence.label}</strong>
            <InsightBar pct={Math.min(100, (month.totalSimulations / 100) * 100)} tone={confidence.className} />
            <strong className="challenge-insight-rate">{fmtNumber(month.totalSimulations)}</strong>
            <small>starts sampled</small>
            <small>{fmtPct(month.passRatePct)} pass rate</small>
            <small>{fmtNumber(month.passCount)} passed</small>
          </div>
        );
      })}
    </div>
  );
}

function LaunchWindowCards({
  currentMonth,
  currentMonthLabel,
  days,
  months
}: {
  currentMonth?: ChallengeMonthPassStat;
  currentMonthLabel: string;
  days: ChallengeStartDayPassStat[];
  months: ChallengeMonthPassStat[];
}) {
  const bestMonths = months.slice(0, 3);
  const softestMonth = [...months].sort((left, right) => left.passRatePct - right.passRatePct)[0];
  const bestDays = days.slice(0, 2);
  return (
    <div className="challenge-insight-card-grid">
      <div className={`challenge-insight-card ${currentMonth ? passRateTone(currentMonth) : "tone-neutral"}`}>
        <span>Current month</span>
        <strong>{currentMonth ? `${currentMonth.label} ${fmtPct(currentMonth.passRatePct)}` : `${currentMonthLabel} --`}</strong>
        <small>{currentMonth ? `${fmtNumber(currentMonth.passCount)} / ${fmtNumber(currentMonth.totalSimulations)} passed` : "No sample yet"}</small>
      </div>
      <div className="challenge-insight-card tone-up">
        <span>Best months</span>
        <strong>{bestMonths.map((month) => month.label).join(", ") || "--"}</strong>
        <small>{bestMonths.map((month) => fmtPct(month.passRatePct)).join(" / ") || "No month ranking"}</small>
      </div>
      <div className="challenge-insight-card tone-up">
        <span>Best launch days</span>
        <strong>{bestDays.map((day) => day.label).join(", ") || "--"}</strong>
        <small>{bestDays.map((day) => fmtPct(day.passRatePct)).join(" / ") || "No day ranking"}</small>
      </div>
      <div className={`challenge-insight-card ${softestMonth ? passRateTone(softestMonth) : "tone-neutral"}`}>
        <span>Weakest month</span>
        <strong>{softestMonth ? `${softestMonth.label} ${fmtPct(softestMonth.passRatePct)}` : "--"}</strong>
        <small>Use this as the caution window</small>
      </div>
    </div>
  );
}

function ChallengeReplayInsights({
  strategies,
  summary
}: {
  strategies: StrategyEditOption[];
  summary: ChallengeReplaySummary;
}) {
  const [currentMonthIndex, setCurrentMonthIndex] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setCurrentMonthIndex(new Date().getMonth());
  }, []);
  const currentMonth = currentMonthIndex == null ? undefined : summary.monthPassStats.find((month) => month.monthIndex === currentMonthIndex);
  const currentMonthLabel = currentMonth?.label ?? monthLabelFromIndex(currentMonthIndex);
  const labels = useMemo(() => new Map(strategies.map((strategy) => [strategy.key, `${strategy.symbol} ${strategy.label}`])), [strategies]);
  const activeView = INSIGHT_VIEW_ORDER[activeIndex] ?? "months";
  const strongestFailure = [...summary.failureReasons].sort((left, right) => right.count - left.count)[0];
  const strongestSensitivity = [...summary.riskSensitivity].sort((left, right) => Math.abs(right.deltaPct) - Math.abs(left.deltaPct))[0];
  const viewMeta: Record<InsightViewKey, { summary: string; title: string }> = {
    months: {
      title: "Start month ranking",
      summary: currentMonth ? `${currentMonth.label} ${fmtPct(currentMonth.passRatePct)}` : `${currentMonthLabel} --`
    },
    endingMonths: {
      title: "End month ranking",
      summary: bestSummary(summary.endingMonthPassStats)
    },
    failures: {
      title: "Why challenges fail",
      summary: strongestFailure ? `${strongestFailure.label} ${fmtPct(strongestFailure.pct)}` : "--"
    },
    pace: {
      title: "Challenge pace distribution",
      summary: summary.monteCarlo.passCount ? fmtChallengeDuration(summary.monteCarlo.medianMinutesToPass) : "--"
    },
    sensitivity: {
      title: "Risk rule heatmap",
      summary: strongestSensitivity ? `${strongestSensitivity.group} ${strongestSensitivity.deltaPct >= 0 ? "+" : ""}${fmtPct(strongestSensitivity.deltaPct)}` : "--"
    },
    distribution: {
      title: "Pass path distribution",
      summary: summary.historical.passCount ? `${fmtNumber(summary.historical.passCount)} passes` : "--"
    },
    streak: {
      title: "Worst streak stress",
      summary: summary.worstStreak.trades ? `${fmtNumber(summary.worstStreak.trades)} losses` : "--"
    },
    strategies: {
      title: "Strategy impact distribution",
      summary: summary.strategyContributions[0] ? fmtMoney(summary.strategyContributions[0].totalPnl, true) : "--"
    },
    confidence: {
      title: "Confidence and sample size",
      summary: currentMonth ? sampleConfidence(currentMonth.totalSimulations).label : "--"
    },
    launch: {
      title: "Best launch window",
      summary: bestSummary(summary.monthPassStats)
    }
  };
  const meta = viewMeta[activeView];
  const previousView = () => setActiveIndex((index) => (index === 0 ? INSIGHT_VIEW_ORDER.length - 1 : index - 1));
  const nextView = () => setActiveIndex((index) => (index + 1) % INSIGHT_VIEW_ORDER.length);

  function renderActiveView() {
    if (activeView === "endingMonths") return <EndingMonthRows currentMonthIndex={currentMonthIndex} months={summary.endingMonthPassStats} />;
    if (activeView === "failures") return <FailureChart reasons={summary.failureReasons} />;
    if (activeView === "pace") return <PaceDistribution summary={summary} />;
    if (activeView === "sensitivity") return <RiskHeatmap rows={summary.riskSensitivity} />;
    if (activeView === "distribution") return <DistributionView summary={summary} />;
    if (activeView === "streak") return <StreakCards streak={summary.worstStreak} />;
    if (activeView === "strategies") return <StrategyContributionRows labels={labels} rows={summary.strategyContributions} />;
    if (activeView === "confidence") return <ConfidenceRows currentMonthIndex={currentMonthIndex} months={summary.monthPassStats} />;
    if (activeView === "launch") {
      return (
        <LaunchWindowCards
          currentMonth={currentMonth}
          currentMonthLabel={currentMonthLabel}
          days={summary.startDayPassStats}
          months={summary.monthPassStats}
        />
      );
    }
    return <MonthRows currentMonthIndex={currentMonthIndex} months={summary.monthPassStats} />;
  }

  return (
    <div className="challenge-month-ranking challenge-insights">
      <div className="challenge-month-head challenge-insight-head">
        <div className="challenge-insight-titlebar">
          <span className="challenge-insight-title">{meta.title}</span>
          <div className="challenge-insight-arrows" aria-label="Replay insight navigation">
            <button type="button" onClick={previousView} aria-label="Previous replay insight">
              &lt;
            </button>
            <small>{activeIndex + 1} / {INSIGHT_VIEW_ORDER.length}</small>
            <button type="button" onClick={nextView} aria-label="Next replay insight">
              &gt;
            </button>
          </div>
        </div>
        <strong>{meta.summary}</strong>
      </div>
      {summary.eligibleTrades ? renderActiveView() : <div className="challenge-month-empty">No replay samples yet.</div>}
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
    trades: trades.map((trade) => [trade.entryTime, trade.key ?? "", Math.round(trade.pnlDollars * 10_000) / 10_000]),
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
    Array.isArray(summary.endingMonthPassStats) &&
    Array.isArray(summary.failureReasons) &&
    Array.isArray(summary.historicalPassRates) &&
    Array.isArray(summary.monthPassStats) &&
    Array.isArray(summary.monteCarloPassRates) &&
    Boolean(summary.passDistribution && typeof summary.passDistribution === "object") &&
    Array.isArray(summary.riskSensitivity) &&
    Array.isArray(summary.startDayPassStats) &&
    Array.isArray(summary.strategyContributions) &&
    Boolean(summary.worstStreak && typeof summary.worstStreak === "object")
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
      key: trade.key,
      pnlDollars: (() => {
        if (trade.lockedSize) return trade.pnlDollars;
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
          console.warn("Challenge replay worker failed; using main-thread fallback.", event.message);
          worker?.terminate();
          worker = null;
          finish(analyzePropFirmChallenge(replayTrades, seed, rules, setReplayProgress));
        };
        worker.postMessage({ id, rules, seed, trades: replayTrades });
      } catch (error) {
        console.warn("Challenge replay worker unavailable; using main-thread fallback.", error);
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
      <ChallengeReplayInsights strategies={strategies} summary={challengeReplay} />
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
