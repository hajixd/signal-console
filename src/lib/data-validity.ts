import { dollarPerUnit } from "@/lib/instruments";
import type { BacktestTrade } from "@/lib/backtest";
import { isDataTimeframe, timeframeOrder, timeframeSeconds } from "@/lib/timeframes";

export type DataValidityTone = "good" | "warning" | "bad";

export type DataValidityIssue = {
  count: number;
  details?: string[];
  label: string;
  tone: Exclude<DataValidityTone, "good">;
};

export type DataValidityCheck = {
  detail: string;
  label: string;
  tone: DataValidityTone;
  value: string;
};

export type DataValidityStats = {
  badIssueCount: number;
  coverageAssetsChecked: number;
  coverageTimeframesChecked: number;
  duplicatePct: number;
  duplicateTrades: number;
  earliestEntryAt?: string;
  latestExitAt?: string;
  latestSignalAt?: string;
  marketCount: number;
  missingCoverageAssets: number;
  missingCoverageTimeframes: number;
  staleCoverageTimeframes: number;
  strategyCount: number;
  symbolCount: number;
  totalIssueCount: number;
  tradesChecked: number;
  warningIssueCount: number;
};

export type DataValidityResult = {
  checks: DataValidityCheck[];
  detailTitle: string;
  issues: DataValidityIssue[];
  label: string;
  stats: DataValidityStats;
  summary: string;
  tone: DataValidityTone;
};

export type DataValidityStrategyRef = {
  assetKey?: string;
  datasetId?: string;
  key: string;
  sizeMultiplier?: number;
  symbol?: string;
  timeframes?: string[];
};

export type DataValidityCoverageRef = {
  assetKey?: string;
  firstBarAt?: string;
  lastBarAt?: string;
  rows?: number;
  symbol?: string;
  timeframes?: string[];
  updatedAt?: string;
};

type DataValidityArgs = {
  assetCoverage?: Record<string, DataValidityCoverageRef | undefined>;
  backtestBehindMarketData: boolean;
  now?: number;
  strategyRefs: DataValidityStrategyRef[];
  trades: BacktestTrade[];
};

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0
});

function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return "inf";
  return NUMBER_FORMATTER.format(value);
}

export function dataValidityRank(tone: DataValidityTone): number {
  if (tone === "bad") return 2;
  if (tone === "warning") return 1;
  return 0;
}

export function dataValidityIssueRank(issue: DataValidityIssue): number {
  return dataValidityRank(issue.tone);
}

export function dataValidityClass(tone: DataValidityTone): string {
  if (tone === "bad") return "bad";
  if (tone === "warning") return "warning";
  return "good";
}

function isoFromMillis(value: number): string | undefined {
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : undefined;
}

function tradeSizeMultiplier(trade: BacktestTrade, fallback = 1): number {
  return trade.sizeMultiplierHint ?? fallback;
}

function tradeDollarPnl(trade: BacktestTrade, sizeMultiplier = 1): number {
  return trade.netUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * tradeSizeMultiplier(trade, sizeMultiplier);
}

function tradeReference(trade: BacktestTrade): string {
  const time = trade.entryTime || trade.signalTime || trade.exitTime || "no time";
  return `${trade.datasetId || "missing strategy"} / ${trade.symbol || "missing symbol"} / ${time}`;
}

function addSample(samples: string[], trade: BacktestTrade, reason: string) {
  if (samples.length >= 3) return;
  samples.push(`${tradeReference(trade)}: ${reason}`);
}

function pushIssue(issues: DataValidityIssue[], count: number, label: string, tone: Exclude<DataValidityTone, "good">, details?: string[]) {
  if (!count) return;
  issues.push({
    count,
    details: details?.length ? details : undefined,
    label,
    tone
  });
}

function checkTone(count: number, warning = false): DataValidityTone {
  if (!count) return "good";
  return warning ? "warning" : "bad";
}

function checkValue(count: number): string {
  return count ? `${fmtNumber(count)} flagged` : "Clean";
}

function sortedTimeframes(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort((left, right) => timeframeOrder(left) - timeframeOrder(right) || left.localeCompare(right));
}

function coverageByAssetKey(assetCoverage: Record<string, DataValidityCoverageRef | undefined> | undefined): Map<string, DataValidityCoverageRef> {
  const byAsset = new Map<string, DataValidityCoverageRef>();
  for (const [key, coverage] of Object.entries(assetCoverage ?? {})) {
    if (!coverage) continue;
    const assetKey = coverage.assetKey ?? key;
    if (!assetKey) continue;
    byAsset.set(assetKey, coverage);
  }
  return byAsset;
}

function requiredTimeframesByAsset(strategyRefs: DataValidityStrategyRef[]): Map<string, { symbol?: string; timeframes: Set<string> }> {
  const required = new Map<string, { symbol?: string; timeframes: Set<string> }>();
  for (const ref of strategyRefs) {
    if (!ref.assetKey) continue;
    const entry = required.get(ref.assetKey) ?? { symbol: ref.symbol, timeframes: new Set<string>() };
    entry.symbol = entry.symbol ?? ref.symbol;
    for (const timeframe of ref.timeframes?.length ? ref.timeframes : ["15m"]) {
      if (timeframe) entry.timeframes.add(timeframe);
    }
    required.set(ref.assetKey, entry);
  }
  return required;
}

function coverageFreshnessToleranceMs(timeframe: string): number | undefined {
  if (!isDataTimeframe(timeframe)) return undefined;
  return Math.max(timeframeSeconds(timeframe) * 3 * 1000, 20 * 60 * 1000);
}

function addCoverageSample(samples: string[], detail: string) {
  if (samples.length >= 4) return;
  samples.push(detail);
}

export function analyzeBacktestDataValidity({
  assetCoverage,
  backtestBehindMarketData,
  now = Date.now(),
  strategyRefs,
  trades
}: DataValidityArgs): DataValidityResult {
  const issues: DataValidityIssue[] = [];
  const strategyByKey = new Map<string, DataValidityStrategyRef>();
  for (const ref of strategyRefs) {
    strategyByKey.set(ref.key, ref);
    if (ref.datasetId) strategyByKey.set(ref.datasetId, ref);
  }

  if (!trades.length) {
    const stats: DataValidityStats = {
      badIssueCount: 1,
      coverageAssetsChecked: 0,
      coverageTimeframesChecked: 0,
      duplicatePct: 0,
      duplicateTrades: 0,
      marketCount: 0,
      missingCoverageAssets: 0,
      missingCoverageTimeframes: 0,
      staleCoverageTimeframes: 0,
      strategyCount: strategyRefs.length,
      symbolCount: 0,
      totalIssueCount: 1,
      tradesChecked: 0,
      warningIssueCount: 0
    };
    return {
      checks: [
        {
          detail: "No stored backtest trades were available for the selected market.",
          label: "Rows parsed",
          tone: "bad",
          value: "0"
        }
      ],
      detailTitle: "No stored backtest trades are available for this market.",
      issues: [{ count: 1, label: "No trades", tone: "bad" }],
      label: "No data",
      stats,
      summary: "Nothing to validate",
      tone: "bad"
    };
  }

  const duplicateFingerprints = new Map<string, number>();
  const markets = new Set<string>();
  const strategyIds = new Set<string>();
  const symbols = new Set<string>();
  const sampleDetails = {
    duplicateTrades: [] as string[],
    futureDated: [] as string[],
    impossibleDurations: [] as string[],
    invalidMath: [] as string[],
    invalidPrices: [] as string[],
    invalidRiskReward: [] as string[],
    invalidSides: [] as string[],
    invalidTimes: [] as string[],
    missingStrategies: [] as string[]
  };

  let earliestEntry = Number.POSITIVE_INFINITY;
  let futureDated = 0;
  let impossibleDurations = 0;
  let invalidMath = 0;
  let invalidPrices = 0;
  let invalidRiskReward = 0;
  let invalidSides = 0;
  let invalidTimes = 0;
  let latestExit = 0;
  let latestSignal = 0;
  let missingStrategies = 0;

  for (const trade of trades) {
    if (trade.market) markets.add(trade.market);
    if (trade.datasetId) strategyIds.add(trade.datasetId);
    if (trade.symbol) symbols.add(trade.symbol);

    const signalTime = Date.parse(trade.signalTime);
    const entryTime = Date.parse(trade.entryTime);
    const exitTime = Date.parse(trade.exitTime);
    const hasInvalidTime = !Number.isFinite(signalTime) || !Number.isFinite(entryTime) || !Number.isFinite(exitTime);

    if (Number.isFinite(signalTime)) latestSignal = Math.max(latestSignal, signalTime);
    if (Number.isFinite(entryTime)) earliestEntry = Math.min(earliestEntry, entryTime);
    if (Number.isFinite(exitTime)) latestExit = Math.max(latestExit, exitTime);

    if (hasInvalidTime) {
      invalidTimes += 1;
      addSample(sampleDetails.invalidTimes, trade, "signal, entry, or exit timestamp is not parseable");
    } else {
      if (
        exitTime < entryTime ||
        !Number.isFinite(trade.entryIndex) ||
        !Number.isFinite(trade.exitIndex) ||
        !Number.isFinite(trade.barsHeld) ||
        trade.exitIndex < trade.entryIndex ||
        trade.barsHeld < 0
      ) {
        impossibleDurations += 1;
        addSample(sampleDetails.impossibleDurations, trade, "exit precedes entry, index order is inverted, or bars held is negative");
      }
      if (signalTime > now + 86_400_000 || entryTime > now + 86_400_000 || exitTime > now + 86_400_000) {
        futureDated += 1;
        addSample(sampleDetails.futureDated, trade, "timestamp is more than one day in the future");
      }
    }

    if (!Number.isFinite(trade.entryPrice) || !Number.isFinite(trade.exitPrice) || trade.entryPrice <= 0 || trade.exitPrice <= 0) {
      invalidPrices += 1;
      addSample(sampleDetails.invalidPrices, trade, "entry or exit price is missing, non-finite, or non-positive");
    }

    const side = trade.side as string;
    if (side !== "long" && side !== "short") {
      invalidSides += 1;
      addSample(sampleDetails.invalidSides, trade, `side is ${side || "missing"}`);
    }

    const ref = strategyByKey.get(trade.datasetId);
    const dollarPnl = tradeDollarPnl(trade, ref?.sizeMultiplier ?? 1);
    if (
      !Number.isFinite(trade.barsHeld) ||
      !Number.isFinite(trade.costUnits) ||
      !Number.isFinite(trade.entryIndex) ||
      !Number.isFinite(trade.exitIndex) ||
      !Number.isFinite(trade.netUnits) ||
      !Number.isFinite(trade.rMultiple) ||
      !Number.isFinite(trade.slUnits) ||
      !Number.isFinite(trade.tpUnits) ||
      !Number.isFinite(dollarPnl)
    ) {
      invalidMath += 1;
      addSample(sampleDetails.invalidMath, trade, "numeric trade fields or derived dollar PnL are not finite");
    }

    if (!(trade.slUnits > 0) || !(trade.tpUnits > 0)) {
      invalidRiskReward += 1;
      addSample(sampleDetails.invalidRiskReward, trade, "stop-loss or take-profit units are zero, negative, or missing");
    }

    if (!ref) {
      missingStrategies += 1;
      addSample(sampleDetails.missingStrategies, trade, "trade datasetId is not present in the active strategy catalog");
    }

    const fingerprint = [
      trade.datasetId,
      trade.symbol,
      trade.side,
      trade.entryTime,
      trade.exitTime,
      trade.entryPrice,
      trade.exitPrice
    ].join("|");
    const duplicateCount = (duplicateFingerprints.get(fingerprint) ?? 0) + 1;
    duplicateFingerprints.set(fingerprint, duplicateCount);
    if (duplicateCount === 2) {
      addSample(sampleDetails.duplicateTrades, trade, "same strategy, symbol, side, entry, exit, and prices appears more than once");
    }
  }

  const duplicateTrades = [...duplicateFingerprints.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const duplicatePct = (duplicateTrades / trades.length) * 100;
  const requiredCoverage = requiredTimeframesByAsset(strategyRefs);
  const coverageMap = coverageByAssetKey(assetCoverage);
  const coverageSamples = {
    missingAssets: [] as string[],
    missingTimeframes: [] as string[],
    staleTimeframes: [] as string[]
  };
  let coverageTimeframesChecked = 0;
  let missingCoverageAssets = 0;
  let missingCoverageTimeframes = 0;
  let missingSpecificCoverageTimeframes = 0;
  let staleCoverageTimeframes = 0;

  for (const [assetKey, requirement] of requiredCoverage) {
    const coverage = coverageMap.get(assetKey);
    const assetLabel = requirement.symbol ?? coverage?.symbol ?? assetKey;
    const requiredTimeframes = sortedTimeframes(requirement.timeframes);
    coverageTimeframesChecked += requiredTimeframes.length;

    if (!coverage) {
      missingCoverageAssets += 1;
      missingCoverageTimeframes += requiredTimeframes.length;
      addCoverageSample(coverageSamples.missingAssets, `${assetLabel}: no coverage metadata for ${requiredTimeframes.join(", ")}`);
      continue;
    }

    const coveredTimeframes = new Set(coverage.timeframes ?? []);
    const lastBarAt = coverage.lastBarAt ? Date.parse(coverage.lastBarAt) : Number.NaN;
    for (const timeframe of requiredTimeframes) {
      if (!coveredTimeframes.has(timeframe)) {
        missingCoverageTimeframes += 1;
        missingSpecificCoverageTimeframes += 1;
        addCoverageSample(coverageSamples.missingTimeframes, `${assetLabel}: missing ${timeframe}`);
        continue;
      }

      const toleranceMs = coverageFreshnessToleranceMs(timeframe);
      if (!toleranceMs) continue;
      if (!Number.isFinite(lastBarAt)) {
        staleCoverageTimeframes += 1;
        addCoverageSample(coverageSamples.staleTimeframes, `${assetLabel} ${timeframe}: latest bar timestamp is unavailable`);
        continue;
      }

      if (lastBarAt < now - toleranceMs) {
        const lagHours = (now - lastBarAt) / 3_600_000;
        addCoverageSample(
          coverageSamples.staleTimeframes,
          `${assetLabel} ${timeframe}: latest ${new Date(lastBarAt).toISOString()} (${fmtNumber(lagHours)}h old)`
        );
        staleCoverageTimeframes += 1;
      }
    }
  }

  pushIssue(issues, invalidTimes, "Invalid timestamps", "bad", sampleDetails.invalidTimes);
  pushIssue(issues, impossibleDurations, "Impossible durations", "bad", sampleDetails.impossibleDurations);
  pushIssue(issues, invalidPrices, "Invalid prices", "bad", sampleDetails.invalidPrices);
  pushIssue(issues, invalidMath, "Invalid math", "bad", sampleDetails.invalidMath);
  pushIssue(issues, invalidRiskReward, "Invalid risk/target", "bad", sampleDetails.invalidRiskReward);
  pushIssue(issues, invalidSides, "Invalid sides", "bad", sampleDetails.invalidSides);
  pushIssue(issues, futureDated, "Future-dated trades", "bad", sampleDetails.futureDated);
  pushIssue(issues, missingStrategies, "Missing strategy rows", "warning", sampleDetails.missingStrategies);
  pushIssue(
    issues,
    duplicateTrades,
    `Potential duplicates (${fmtNumber(duplicatePct)}%)`,
    duplicatePct >= 5 ? "bad" : "warning",
    sampleDetails.duplicateTrades
  );
  pushIssue(issues, backtestBehindMarketData ? 1 : 0, "Backtest behind market data", "warning");
  pushIssue(issues, missingCoverageAssets, "Missing asset coverage", "bad", coverageSamples.missingAssets);
  pushIssue(issues, missingSpecificCoverageTimeframes, "Missing asset timeframes", "bad", coverageSamples.missingTimeframes);
  pushIssue(issues, staleCoverageTimeframes, "Stale asset timeframes", "warning", coverageSamples.staleTimeframes);

  const tone = issues.reduce<DataValidityTone>(
    (current, issue) => (dataValidityIssueRank(issue) > dataValidityRank(current) ? issue.tone : current),
    "good"
  );
  const sortedIssues = [...issues].sort((left, right) => dataValidityIssueRank(right) - dataValidityIssueRank(left) || right.count - left.count);
  const badIssueCount = sortedIssues.filter((issue) => issue.tone === "bad").reduce((sum, issue) => sum + issue.count, 0);
  const warningIssueCount = sortedIssues.filter((issue) => issue.tone === "warning").reduce((sum, issue) => sum + issue.count, 0);
  const totalIssueCount = badIssueCount + warningIssueCount;
  const stats: DataValidityStats = {
    badIssueCount,
    coverageAssetsChecked: requiredCoverage.size,
    coverageTimeframesChecked,
    duplicatePct,
    duplicateTrades,
    earliestEntryAt: isoFromMillis(earliestEntry),
    latestExitAt: isoFromMillis(latestExit),
    latestSignalAt: isoFromMillis(latestSignal),
    marketCount: markets.size,
    missingCoverageAssets,
    missingCoverageTimeframes,
    staleCoverageTimeframes,
    strategyCount: strategyIds.size,
    symbolCount: symbols.size,
    totalIssueCount,
    tradesChecked: trades.length,
    warningIssueCount
  };

  const checks: DataValidityCheck[] = [
    {
      detail: `${fmtNumber(strategyIds.size)} strategies / ${fmtNumber(symbols.size)} symbols / ${fmtNumber(markets.size)} markets were represented.`,
      label: "Rows parsed",
      tone: "good",
      value: fmtNumber(trades.length)
    },
    {
      detail: "Signal, entry, and exit timestamps must all parse as finite dates.",
      label: "Timestamp integrity",
      tone: checkTone(invalidTimes),
      value: checkValue(invalidTimes)
    },
    {
      detail: "Exit time, exit index, and bars held must be coherent with the entry.",
      label: "Duration order",
      tone: checkTone(impossibleDurations),
      value: checkValue(impossibleDurations)
    },
    {
      detail: "Entry and exit prices must be finite and positive.",
      label: "Price sanity",
      tone: checkTone(invalidPrices),
      value: checkValue(invalidPrices)
    },
    {
      detail: "R, units, cost, bars, indices, and derived dollar PnL must be finite.",
      label: "Numeric math",
      tone: checkTone(invalidMath),
      value: checkValue(invalidMath)
    },
    {
      detail: "Stop-loss and take-profit unit distances must be positive.",
      label: "Risk/target units",
      tone: checkTone(invalidRiskReward),
      value: checkValue(invalidRiskReward)
    },
    {
      detail: "Every trade should resolve to a strategy visible in the active catalog.",
      label: "Catalog coverage",
      tone: checkTone(missingStrategies, true),
      value: checkValue(missingStrategies)
    },
    {
      detail: "Exact duplicate fingerprints are counted by strategy, symbol, side, times, and prices.",
      label: "Duplicate scan",
      tone: duplicateTrades ? (duplicatePct >= 5 ? "bad" : "warning") : "good",
      value: duplicateTrades ? `${fmtNumber(duplicateTrades)} found` : "Clean"
    },
    {
      detail: "Trade timestamps should not be more than one day ahead of the server clock.",
      label: "Clock drift",
      tone: checkTone(futureDated),
      value: checkValue(futureDated)
    },
    {
      detail: "The backtest snapshot should not lag stored market-data coverage.",
      label: "Data freshness",
      tone: backtestBehindMarketData ? "warning" : "good",
      value: backtestBehindMarketData ? "Behind" : "Current"
    },
    {
      detail: `Runtime coverage must include every required timeframe for each strategy asset (${fmtNumber(requiredCoverage.size)} assets checked).`,
      label: "Asset timeframes",
      tone:
        missingCoverageAssets || missingCoverageTimeframes
          ? "bad"
          : staleCoverageTimeframes
            ? "warning"
            : "good",
      value:
        missingCoverageAssets || missingCoverageTimeframes
          ? `${fmtNumber(missingCoverageTimeframes || missingCoverageAssets)} missing`
          : staleCoverageTimeframes
            ? `${fmtNumber(staleCoverageTimeframes)} stale`
            : "Current"
    }
  ];

  const issueSummary = sortedIssues
    .slice(0, 3)
    .map((issue) => `${fmtNumber(issue.count)} ${issue.label.toLowerCase()}`)
    .join(" / ");
  const summary = issueSummary || `${fmtNumber(trades.length)} trades / ${fmtNumber(strategyIds.size)} strategies / ${fmtNumber(symbols.size)} symbols`;
  const detailTitle = sortedIssues.length
    ? sortedIssues
        .map((issue) => {
          const details = issue.details?.length ? `\n  ${issue.details.join("\n  ")}` : "";
          return `${issue.label}: ${fmtNumber(issue.count)}${details}`;
        })
        .join("\n")
    : `Checked ${fmtNumber(trades.length)} trades across ${fmtNumber(strategyIds.size)} strategies with no anomalies found.`;

  return {
    checks,
    detailTitle,
    issues: sortedIssues,
    label: tone === "bad" ? "Sus" : tone === "warning" ? "Review" : "Clean",
    stats,
    summary,
    tone
  };
}
