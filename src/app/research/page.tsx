import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import AutoTradeAccountGate from "@/components/auto-trading/auto-trade-account-gate";
import AutoTradeAccountModeSwitch from "@/components/auto-trading/auto-trade-account-mode-switch";
import ResearchBacktestTable, { type ResearchBacktestMetrics } from "@/components/research/research-backtest-table";
import ResearchIdeaForm, { type ResearchAssetOption } from "@/components/research/research-idea-form";
import ResearchIdeaList from "@/components/research/research-idea-list";
import ResearchStrategyList from "@/components/research/research-strategy-list";
import AutoRefresh from "@/components/ui/auto-refresh";
import LocalDateTime from "@/components/ui/local-date-time";
import ThemeToggle from "@/components/ui/theme-toggle";
import { getDatasetStatus } from "@/lib/live-config";

export const dynamic = "force-dynamic";

const RESEARCH_ROOT = path.join(process.cwd(), "Research");
const ASSETS_PATH = path.join(process.cwd(), "config", "assets.json");
const RESEARCH_STATUS_PATH = path.join(RESEARCH_ROOT, "runtime", "research-cycle-status.json");
const RESEARCH_STAGE_STATUS_PATH = path.join(RESEARCH_ROOT, "runtime", "research-stage-status.json");
const HIDDEN_ENTRY_NAMES = new Set([".gitkeep"]);
const RESEARCH_STAGE_ORDER = ["research", "idea", "coding", "backtest"] as const;
const RESEARCH_FINISHED_MIN_PF = 2;
const RESEARCH_FINISHED_MIN_TRADES = 21;
const RESEARCH_STAGE_SCHEDULE_UTC = {
  backtest: [
    { hour: 22, minute: 0 },
    { hour: 6, minute: 0 }
  ],
  coding: [
    { hour: 19, minute: 0 },
    { hour: 3, minute: 0 }
  ],
  idea: [
    { hour: 16, minute: 0 },
    { hour: 0, minute: 0 }
  ],
  research: [{ hour: 13, minute: 0 }]
} satisfies Record<ResearchStage, Array<{ hour: number; minute: number }>>;
const RESEARCH_STAGE_TITLES = {
  backtest: "Backtest Review",
  coding: "Strategy Coding",
  idea: "Idea Formalization",
  research: "Idea Discovery"
} satisfies Record<ResearchStage, string>;
const RESEARCH_STAGE_DESCRIPTIONS = {
  backtest: "Runs coded strategies through the deterministic backtest engine and records detailed statistics.",
  coding: "Uses the coding LLM to turn formalized ideas into executable strategy specs.",
  idea: "Uses the idea LLM to organize raw research into formalized, testable strategy plans.",
  research: "Uses You.com and LLM research to discover new trading ideas online."
} satisfies Record<ResearchStage, string>;

type ResearchStage = (typeof RESEARCH_STAGE_ORDER)[number];

type ResearchIdea = {
  assetKeys?: string[];
  createdAt?: string;
  engines?: string[];
  fileId?: string;
  hypothesis?: string;
  ideaReport?: {
    assetSelection?: string;
    entry?: string;
    entryConditions?: string;
    exit?: string;
    exitConditions?: string;
    extraNotes?: string;
    filters?: string[];
    implementationNotes?: string[];
    invalidations?: string[];
    limitOrderPlan?: string;
    overallDescription?: string;
    parameterNotes?: string[];
    setup?: string;
    sourceInterpretation?: string;
    stop?: string;
    stopLossPlan?: string;
    summary?: string;
    takeProfitPlan?: string;
    target?: string;
    timeframes?: string[];
    useLimitOrder?: string;
  };
  ideaId?: string;
  markets?: string[];
  notes?: string;
  provenance?: string;
  sourceUrls?: string[];
  status?: string;
  timeframes?: string[];
  title?: string;
};

type StrategySpec = {
  assetKey?: string;
  createdAt?: string;
  engine?: string;
  fileId?: string;
  ideaId?: string;
  ideaReport?: ResearchIdea["ideaReport"];
  llm?: Record<string, unknown>;
  market?: string;
  params?: Record<string, unknown>;
  provenance?: string;
  sourceUrls?: string[];
  status?: string;
  strategyId?: string;
  symbol?: string;
  thresholds?: {
    minProfitFactor?: number;
    minTrades?: number;
  };
  title?: string;
};

type BacktestRow = {
  asset_key: string;
  backtestedAt?: string;
  engine: string;
  exitReasons?: Record<string, number>;
  hypothesis?: string;
  ideaReport?: ResearchIdea["ideaReport"];
  market: string;
  metrics?: ResearchBacktestMetrics;
  params?: Record<string, unknown>;
  profit_factor: string;
  qualified: string;
  sourceUrls?: string[];
  status: string;
  strategyId?: string;
  strategy_id: string;
  symbol?: string;
  thresholds?: {
    minProfitFactor?: number;
    minTrades?: number;
  };
  title?: string;
  total_r: string;
  trades: string;
};

type LatestReport = {
  lines: string[];
  name: string;
  updatedAt: Date;
} | null;

type ResearchCycleStatus = {
  durationMs?: number;
  error?: string;
  finishedAt?: string;
  jobsLastRun?: number;
  lastSuccessAt?: string;
  limit?: number;
  maxPerIdea?: number;
  minPf?: string;
  minTrades?: number;
  startedAt?: string;
  stage?: string;
  state?: "idle" | "running" | "success" | "failed";
  updatedAt?: string;
} | null;
type ResearchStageStatus = NonNullable<ResearchCycleStatus>;
type ResearchStageStatusMap = Partial<Record<ResearchStage, ResearchStageStatus>>;

type ResearchSnapshot = {
  approvedIdeas: ResearchIdea[];
  approvedIdeaCount: number;
  backtestReviewRows: BacktestRow[];
  backtestedRows: BacktestRow[];
  backtestedCount: number;
  belowRequirementRows: BacktestRow[];
  finishedRows: BacktestRow[];
  fetchedPagesCount: number;
  inboxIdeaCount: number;
  inboxIdeas: ResearchIdea[];
  latestReport: LatestReport;
  pendingReadyCount: number;
  qualifiedCount: number;
  readyCount: number;
  readySpecs: StrategySpec[];
  researchStatus: ResearchCycleStatus;
  researchStageStatuses: ResearchStageStatusMap;
  reportCount: number;
  searchResultCount: number;
};

async function safeReadDir(relativePath: string) {
  try {
    return await fs.readdir(path.join(RESEARCH_ROOT, relativePath), { withFileTypes: true });
  } catch {
    return [];
  }
}

function isVisibleEntryName(name: string) {
  return !HIDDEN_ENTRY_NAMES.has(name) && !name.startsWith("_");
}

async function countFiles(relativePath: string, extension?: string) {
  const entries = await safeReadDir(relativePath);
  return entries.filter((entry) => entry.isFile() && isVisibleEntryName(entry.name) && (!extension || entry.name.endsWith(extension))).length;
}

async function listDirectoryNames(relativePath: string) {
  const entries = await safeReadDir(relativePath);
  return entries.filter((entry) => entry.isDirectory() && isVisibleEntryName(entry.name)).map((entry) => entry.name).sort();
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readResearchAssetOptions(): Promise<ResearchAssetOption[]> {
  const payload = await readJsonFile<Record<string, { market?: string; name?: string; symbol?: string }>>(ASSETS_PATH);
  if (!payload) return [];
  return Object.entries(payload)
    .filter(([, asset]) => asset.market === "futures" || asset.market === "forex")
    .map(([key, asset]) => ({
      key,
      label: asset.name ?? key,
      symbol: asset.symbol ?? key
    }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

async function readJsonFiles<T>(relativePath: string, limit: number) {
  const entries = await safeReadDir(relativePath);
  const files = entries
    .filter((entry) => entry.isFile() && isVisibleEntryName(entry.name) && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()
    .slice(0, limit);

  const values = await Promise.all(files.map((name) => readJsonFile<T>(path.join(RESEARCH_ROOT, relativePath, name))));
  const parsedValues: T[] = [];
  values.forEach((value, index) => {
    if (!value) return;
    if (typeof value === "object") {
      parsedValues.push({
        ...value,
        fileId: path.basename(files[index] ?? "", ".json")
      });
      return;
    }
    parsedValues.push(value);
  });
  return parsedValues;
}

function ideaTime(value: ResearchIdea) {
  const timestamp = value.createdAt ? new Date(value.createdAt).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function readStrategySpecs(relativePath: string, limit: number, excludedFolders = new Set<string>()) {
  const folders = (await listDirectoryNames(relativePath)).filter((folder) => !excludedFolders.has(folder));
  const values = await Promise.all(
    folders.slice(0, limit).map(async (folder) => {
      const spec = await readJsonFile<StrategySpec>(path.join(RESEARCH_ROOT, relativePath, folder, "strategy.json"));
      return spec ? { ...spec, fileId: folder } : null;
    })
  );
  const specs: StrategySpec[] = [];
  for (const value of values) {
    if (value) specs.push(value);
  }
  return specs;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

async function readBacktestSummary() {
  try {
    const content = await fs.readFile(path.join(RESEARCH_ROOT, "strategies", "backtested", "_summary.csv"), "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const headers = lines[0] ? parseCsvLine(lines[0]) : [];
    return lines.slice(1).map((line) => {
      const values = parseCsvLine(line);
      return headers.reduce<Record<string, string>>((row, header, index) => {
        row[header] = values[index] ?? "";
        return row;
      }, {}) as unknown as BacktestRow;
    });
  } catch {
    return [];
  }
}

type ResearchBacktestTrade = {
  exit_reason?: string;
  r_multiple?: string;
  side?: string;
};

function numericValues(values: number[]) {
  return values.filter((value) => Number.isFinite(value));
}

function median(values: number[]) {
  const sorted = numericValues(values).sort((left, right) => left - right);
  if (!sorted.length) return undefined;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function average(values: number[]) {
  const normalized = numericValues(values);
  if (!normalized.length) return undefined;
  return normalized.reduce((total, value) => total + value, 0) / normalized.length;
}

function maxDrawdown(values: number[]) {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

async function readBacktestTradeRows(strategyId: string): Promise<ResearchBacktestTrade[]> {
  try {
    const content = await fs.readFile(path.join(RESEARCH_ROOT, "strategies", "backtested", strategyId, "backtest_trades.csv"), "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const headers = lines[0] ? parseCsvLine(lines[0]) : [];
    return lines.slice(1).map((line) => {
      const values = parseCsvLine(line);
      return headers.reduce<Record<string, string>>((row, header, index) => {
        row[header] = values[index] ?? "";
        return row;
      }, {}) as ResearchBacktestTrade;
    });
  } catch {
    return [];
  }
}

function metricsFromTrades(row: BacktestRow, trades: ResearchBacktestTrade[]): ResearchBacktestMetrics {
  const rValues = trades.map((trade) => Number(trade.r_multiple)).filter((value) => Number.isFinite(value));
  const wins = rValues.filter((value) => value > 0);
  const losses = rValues.filter((value) => value < 0);
  const grossWinR = wins.reduce((total, value) => total + value, 0);
  const grossLossR = Math.abs(losses.reduce((total, value) => total + value, 0));
  const totalR = rValues.reduce((total, value) => total + value, 0);
  const tradesCount = rValues.length || backtestTradeCount(row);
  const rowProfitFactor = Number(row.profit_factor);
  const rowTotalR = Number(row.total_r);

  return {
    averageLossR: average(losses),
    averageR: average(rValues),
    averageWinR: average(wins),
    bestWinR: wins.length ? Math.max(...wins) : undefined,
    expectancyR: tradesCount ? totalR / tradesCount : undefined,
    grossLossR,
    grossWinR,
    losses: losses.length,
    maxDrawdownR: maxDrawdown(rValues),
    medianR: median(rValues),
    profitFactor: grossLossR > 0 ? grossWinR / grossLossR : Number.isFinite(rowProfitFactor) ? rowProfitFactor : undefined,
    totalR: rValues.length ? totalR : Number.isFinite(rowTotalR) ? rowTotalR : undefined,
    trades: tradesCount,
    winRatePct: tradesCount ? (wins.length / tradesCount) * 100 : undefined,
    wins: wins.length,
    worstLossR: losses.length ? Math.min(...losses) : undefined
  };
}

function exitReasonsFromTrades(trades: ResearchBacktestTrade[]) {
  const reasons: Record<string, number> = {};
  for (const trade of trades) {
    const reason = trade.exit_reason?.trim() || "unknown";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return reasons;
}

async function hydrateBacktestRows(rows: BacktestRow[]): Promise<BacktestRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      const strategyId = row.strategy_id;
      const [spec, trades] = await Promise.all([
        readJsonFile<StrategySpec>(path.join(RESEARCH_ROOT, "strategies", "backtested", strategyId, "strategy.json")),
        readBacktestTradeRows(strategyId)
      ]);
      return {
        ...row,
        ...spec,
        asset_key: row.asset_key,
        engine: row.engine,
        exitReasons: exitReasonsFromTrades(trades),
        market: row.market,
        metrics: metricsFromTrades(row, trades),
        profit_factor: row.profit_factor,
        qualified: row.qualified,
        status: row.status,
        strategy_id: row.strategy_id,
        total_r: row.total_r,
        trades: row.trades
      };
    })
  );
}

function backtestProfitFactor(row: BacktestRow) {
  const value = Number(row.profit_factor);
  return Number.isFinite(value) ? value : 0;
}

function backtestTradeCount(row: BacktestRow) {
  const value = Number(row.trades);
  return Number.isFinite(value) ? value : 0;
}

function isFinishedBacktestRow(row: BacktestRow) {
  return row.qualified === "True" || (backtestProfitFactor(row) >= RESEARCH_FINISHED_MIN_PF && backtestTradeCount(row) >= RESEARCH_FINISHED_MIN_TRADES);
}

async function readLatestReport(): Promise<LatestReport> {
  const entries = await safeReadDir("reports");
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isVisibleEntryName(entry.name) && entry.name.endsWith(".md"))
      .map(async (entry) => {
        const filePath = path.join(RESEARCH_ROOT, "reports", entry.name);
        const stats = await fs.stat(filePath);
        return { filePath, name: entry.name, updatedAt: stats.mtime };
      })
  );
  const latest = files.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
  if (!latest) return null;

  const lines = (await fs.readFile(latest.filePath, "utf8")).split(/\r?\n/).filter((line) => line.trim()).slice(0, 12);
  return { lines, name: latest.name, updatedAt: latest.updatedAt };
}

function isResearchStage(value: unknown): value is ResearchStage {
  return value === "research" || value === "idea" || value === "coding" || value === "backtest";
}

async function readResearchCycleStatuses(): Promise<{ cycle: ResearchCycleStatus; stages: ResearchStageStatusMap }> {
  const localCycle = await readJsonFile<NonNullable<ResearchCycleStatus>>(RESEARCH_STATUS_PATH);
  const localStages = (await readJsonFile<ResearchStageStatusMap>(RESEARCH_STAGE_STATUS_PATH)) ?? {};
  const datasetStatus = await getDatasetStatus().catch(() => null);
  const researchCycle = datasetStatus?.sync?.researchCycle;
  const datasetStages = datasetStatus?.sync?.researchStages ?? {};
  const cycle = researchCycle
    ? {
        ...researchCycle,
        lastSuccessAt: datasetStatus?.sync?.lastResearchCycleAt
      }
    : localCycle;
  const stages: ResearchStageStatusMap = {
    ...localStages,
    ...datasetStages
  };

  if (researchCycle) {
    const stage = researchCycle.stage;
    if (isResearchStage(stage)) {
      stages[stage] = {
        ...(stages[stage] ?? {}),
        ...researchCycle,
        lastSuccessAt: datasetStatus?.sync?.lastResearchCycleAt,
        stage
      };
    }
  }

  if (localCycle && isResearchStage(localCycle.stage) && !stages[localCycle.stage]) {
    stages[localCycle.stage] = localCycle;
  }

  return { cycle, stages };
}

async function getResearchSnapshot(): Promise<ResearchSnapshot> {
  const readyFolders = await listDirectoryNames("strategies/ready_to_backtest");
  const backtestedFolders = await listDirectoryNames("strategies/backtested");
  const backtestedIds = new Set(backtestedFolders);
  const pendingReadyFolders = readyFolders.filter((folder) => !backtestedIds.has(folder));
  const candidateRows = await hydrateBacktestRows(
    (await readBacktestSummary()).sort((left, right) => Number(right.profit_factor) - Number(left.profit_factor))
  );
  const finishedRows = candidateRows.filter(isFinishedBacktestRow);
  const belowRequirementRows = candidateRows.filter((row) => !isFinishedBacktestRow(row));
  const backtestReviewRows = candidateRows.filter((row) => !isFinishedBacktestRow(row) && row.status !== "cached");
  const inboxIdeas = (await readJsonFiles<ResearchIdea>("ideas/inbox", 60)).sort((left, right) => ideaTime(right) - ideaTime(left));
  const approvedIdeas = (await readJsonFiles<ResearchIdea>("ideas/approved", 60)).sort((left, right) => ideaTime(right) - ideaTime(left));
  const researchStatuses = await readResearchCycleStatuses();

  return {
    approvedIdeas,
    approvedIdeaCount: await countFiles("ideas/approved", ".json"),
    backtestReviewRows,
    backtestedRows: candidateRows,
    backtestedCount: backtestedFolders.length,
    belowRequirementRows,
    finishedRows,
    fetchedPagesCount: await countFiles("sources/pages", ".json"),
    inboxIdeaCount: await countFiles("ideas/inbox", ".json"),
    inboxIdeas,
    latestReport: await readLatestReport(),
    pendingReadyCount: pendingReadyFolders.length,
    qualifiedCount: finishedRows.length,
    readyCount: pendingReadyFolders.length,
    readySpecs: await readStrategySpecs("strategies/ready_to_backtest", 10, backtestedIds),
    researchStatus: researchStatuses.cycle,
    researchStageStatuses: researchStatuses.stages,
    reportCount: await countFiles("reports", ".md"),
    searchResultCount: await countFiles("sources/search_results", ".json")
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(ms: number | undefined) {
  if (!ms || !Number.isFinite(ms)) return "n/a";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function nextResearchStageRunIso(stage: ResearchStage, now = new Date()) {
  const candidates: Date[] = [];
  const schedules = RESEARCH_STAGE_SCHEDULE_UTC[stage];
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const schedule of schedules) {
      const candidate = new Date(now);
      candidate.setUTCDate(now.getUTCDate() + dayOffset);
      candidate.setUTCHours(schedule.hour, schedule.minute, 0, 0);
      if (candidate > now) candidates.push(candidate);
    }
  }
  return candidates.sort((left, right) => left.getTime() - right.getTime())[0]?.toISOString() ?? now.toISOString();
}

function laneState(count: number) {
  return count > 0 ? "active" : "inactive";
}

type SyncTileState = "failed" | "idle" | "running" | "success";
type ResearchDetailTone = "bad" | "good" | "warning";
type ResearchDetailCheck = {
  detail?: string;
  label: string;
  tone?: ResearchDetailTone;
  value: string;
};

function syncTileStateFromResearch(status: ResearchCycleStatus, snapshot: ResearchSnapshot): SyncTileState {
  if (status?.state === "failed") return "failed";
  if (status?.state === "running") return "running";
  if (
    status?.state === "success" ||
    snapshot.inboxIdeaCount > 0 ||
    snapshot.approvedIdeaCount > 0 ||
    snapshot.reportCount > 0 ||
    snapshot.readyCount > 0 ||
    snapshot.backtestedCount > 0
  ) {
    return "success";
  }
  return "idle";
}

function stageOutputCount(snapshot: ResearchSnapshot, stage: ResearchStage) {
  if (stage === "research") return snapshot.inboxIdeaCount;
  if (stage === "idea") return snapshot.approvedIdeaCount;
  if (stage === "coding") return snapshot.readyCount;
  return snapshot.backtestReviewRows.length;
}

function syncTileStateFromStage(status: ResearchStageStatus | undefined, outputCount: number): SyncTileState {
  if (status?.state === "failed") return "failed";
  if (status?.state === "running") return "running";
  if (status?.state === "success" || status?.finishedAt || outputCount > 0) return "success";
  return "idle";
}

function currentActivity(snapshot: ResearchSnapshot) {
  if (snapshot.inboxIdeaCount > 0 || snapshot.approvedIdeaCount > 0) {
    return `${formatNumber(snapshot.inboxIdeaCount)} in Idea Discovery / ${formatNumber(snapshot.approvedIdeaCount)} in Idea Formalization`;
  }
  if (snapshot.pendingReadyCount > 0) return `${formatNumber(snapshot.pendingReadyCount)} coded strateg${snapshot.pendingReadyCount === 1 ? "y" : "ies"} waiting for backtests`;
  if (snapshot.qualifiedCount > 0) return `${formatNumber(snapshot.qualifiedCount)} finished strateg${snapshot.qualifiedCount === 1 ? "y" : "ies"} cleared the requirements`;
  if (snapshot.backtestedCount > 0) return "Backtest results are waiting for a finished PF > 2 result";
  if (snapshot.readyCount > 0) return "Coded strategies are staged for the next backtest pass";
  if (snapshot.approvedIdeaCount > 0) return "Formalized ideas are waiting to become coded strategies";
  return "Idea discovery is ready for new inputs";
}

function stageLastRunAt(status: ResearchStageStatus | undefined) {
  return status?.finishedAt ?? status?.lastSuccessAt ?? status?.startedAt;
}

function stageJobsLastRun(status: ResearchStageStatus | undefined) {
  return typeof status?.jobsLastRun === "number" ? formatNumber(status.jobsLastRun) : "n/a";
}

function stageDurationLabel(status: ResearchStageStatus | undefined) {
  return status?.state === "running" ? "Running for" : "Last duration";
}

function stageDurationMs(status: ResearchStageStatus | undefined) {
  if (status?.state === "running" && status.startedAt) {
    const startedAt = Date.parse(status.startedAt);
    if (Number.isFinite(startedAt)) return Math.max(0, Date.now() - startedAt);
  }
  return status?.durationMs;
}

function researchDetailClass(tone: ResearchDetailTone | undefined) {
  if (tone === "bad") return "bad";
  if (tone === "warning") return "warning";
  return "good";
}

function stageIntervalText(stage: ResearchStage) {
  return RESEARCH_STAGE_SCHEDULE_UTC[stage].length > 1 ? "Twice daily" : "Daily";
}

function stageScopeText(snapshot: ResearchSnapshot, stage: ResearchStage) {
  if (stage === "research") {
    return `${formatNumber(snapshot.searchResultCount)} searches / ${formatNumber(snapshot.fetchedPagesCount)} pages`;
  }
  if (stage === "idea") {
    return `${formatNumber(snapshot.inboxIdeaCount)} inbox / ${formatNumber(snapshot.approvedIdeaCount)} formalized`;
  }
  if (stage === "coding") {
    return `${formatNumber(snapshot.approvedIdeaCount)} ideas / ${formatNumber(snapshot.readyCount)} ready specs`;
  }
  return `${formatNumber(snapshot.backtestedCount)} tested / ${formatNumber(snapshot.qualifiedCount)} qualified`;
}

function stageOutputLabel(stage: ResearchStage) {
  if (stage === "research") return "Inbox ideas";
  if (stage === "idea") return "Formalized";
  if (stage === "coding") return "Ready specs";
  return "Review rows";
}

function stageStatusTimestamp(status: ResearchStageStatus | undefined, state: SyncTileState) {
  if (state === "running" && status?.startedAt) return { label: "started", value: status.startedAt };
  if (state === "success") {
    const value = status?.finishedAt ?? status?.lastSuccessAt;
    return value ? { label: "at", value } : undefined;
  }
  if (state === "failed") {
    const value = status?.finishedAt ?? status?.startedAt;
    return value ? { label: "at", value } : undefined;
  }
  return undefined;
}

function stageStatusLabel(status: ResearchStageStatus | undefined, state: SyncTileState, outputCount: number) {
  if (state === "running") return "Running";
  if (state === "failed") return "Failed";
  if (state === "success") return status?.state === "success" || status?.finishedAt || status?.lastSuccessAt ? "Success" : "Output available";
  return outputCount > 0 ? "Output queued" : "Waiting";
}

function ResearchStageStatusValue({
  outputCount,
  state,
  status
}: {
  outputCount: number;
  state: SyncTileState;
  status: ResearchStageStatus | undefined;
}) {
  const timestamp = stageStatusTimestamp(status, state);
  return (
    <>
      <span className="sync-status-value" title={status?.error}>
        <span>{stageStatusLabel(status, state, outputCount)}</span>
        {timestamp ? (
          <span className="sync-status-date">
            {timestamp.label} <LocalDateTime value={timestamp.value} />
          </span>
        ) : null}
      </span>
      {state === "failed" && status?.error ? (
        <span className="sync-status-error" title={status.error}>
          {status.error.length > 220 ? `${status.error.slice(0, 217)}...` : status.error}
        </span>
      ) : null}
    </>
  );
}

function ResearchTileChecks({ ariaLabel, checks }: { ariaLabel: string; checks: ResearchDetailCheck[] }) {
  return (
    <div className="dataValidityChecks syncTileChecks" aria-label={ariaLabel}>
      {checks.map((check) => (
        <div className={`dataValidityCheck ${researchDetailClass(check.tone)}`} key={check.label} title={check.detail}>
          <span>{check.label}</span>
          <strong>{check.value}</strong>
        </div>
      ))}
    </div>
  );
}

function stageDetailChecks(snapshot: ResearchSnapshot, stage: ResearchStage, status: ResearchStageStatus | undefined): ResearchDetailCheck[] {
  const runtime = formatDuration(stageDurationMs(status));
  const jobs = stageJobsLastRun(status);
  const lastRun = stageLastRunAt(status);
  const base: ResearchDetailCheck[] = [
    {
      detail: "Number of jobs recorded by the most recent stage run.",
      label: "Jobs last run",
      tone: status?.state === "failed" ? "bad" : jobs === "n/a" ? "warning" : "good",
      value: jobs
    },
    {
      detail: "Most recently recorded duration for this stage.",
      label: status?.state === "running" ? "Runtime now" : "Last runtime",
      tone: runtime === "n/a" ? "warning" : "good",
      value: runtime
    },
    {
      detail: "Configured cadence for this stage.",
      label: "Cadence",
      value: stageIntervalText(stage)
    },
    {
      detail: "Last stage completion or start timestamp recorded in the status file.",
      label: "Status file",
      tone: lastRun ? "good" : "warning",
      value: lastRun ? "Recorded" : "Missing"
    }
  ];

  if (stage === "research") {
    return [
      {
        detail: "Current raw idea files waiting in Research/ideas/inbox.",
        label: "Inbox ideas",
        value: formatNumber(snapshot.inboxIdeaCount)
      },
      {
        detail: "Search result files captured from online research.",
        label: "Search files",
        value: formatNumber(snapshot.searchResultCount)
      },
      {
        detail: "Fetched source pages stored for later idea formalization.",
        label: "Fetched pages",
        value: formatNumber(snapshot.fetchedPagesCount)
      },
      {
        detail: "Markdown research reports available in Research/reports.",
        label: "Reports",
        value: formatNumber(snapshot.reportCount)
      },
      ...base
    ];
  }

  if (stage === "idea") {
    return [
      {
        detail: "Raw discovered ideas still available for formalization.",
        label: "Inbox queue",
        value: formatNumber(snapshot.inboxIdeaCount)
      },
      {
        detail: "Formalized, testable strategy plans in Research/ideas/approved.",
        label: "Approved ideas",
        value: formatNumber(snapshot.approvedIdeaCount)
      },
      {
        detail: "Formalized ideas currently available for the coding stage.",
        label: "Coding input",
        tone: snapshot.approvedIdeaCount > 0 ? "good" : "warning",
        value: formatNumber(snapshot.approvedIdeaCount)
      },
      {
        detail: "Latest generated report available for review.",
        label: "Latest report",
        tone: snapshot.latestReport ? "good" : "warning",
        value: snapshot.latestReport ? "Available" : "Missing"
      },
      ...base
    ];
  }

  if (stage === "coding") {
    return [
      {
        detail: "Formalized idea files available as coding inputs.",
        label: "Idea inputs",
        value: formatNumber(snapshot.approvedIdeaCount)
      },
      {
        detail: "Executable strategy specs ready for the backtest stage.",
        label: "Ready specs",
        value: formatNumber(snapshot.readyCount)
      },
      {
        detail: "Ready specs that are not yet represented in backtested results.",
        label: "Pending tests",
        tone: snapshot.pendingReadyCount > 0 ? "warning" : "good",
        value: formatNumber(snapshot.pendingReadyCount)
      },
      {
        detail: "Loaded ready-to-backtest spec samples displayed lower on the page.",
        label: "Spec samples",
        value: formatNumber(snapshot.readySpecs.length)
      },
      ...base
    ];
  }

  return [
    {
      detail: `Configured completion gate is PF > ${RESEARCH_FINISHED_MIN_PF} with at least ${RESEARCH_FINISHED_MIN_TRADES} trades.`,
      label: "PF/trade gate",
      value: `>${RESEARCH_FINISHED_MIN_PF} / ${RESEARCH_FINISHED_MIN_TRADES}+`
    },
    {
      detail: "All strategy folders with backtest output available for review.",
      label: "Backtested",
      value: formatNumber(snapshot.backtestedCount)
    },
    {
      detail: "Backtests that satisfy the Research page finished strategy requirement.",
      label: "Finished",
      tone: snapshot.qualifiedCount > 0 ? "good" : "warning",
      value: formatNumber(snapshot.qualifiedCount)
    },
    {
      detail: "Backtest rows that still need review or do not meet the current completion gate.",
      label: "Review queue",
      tone: snapshot.backtestReviewRows.length > 0 ? "warning" : "good",
      value: formatNumber(snapshot.backtestReviewRows.length)
    },
    ...base
  ];
}

function ResearchStageTile({ snapshot, stage }: { snapshot: ResearchSnapshot; stage: ResearchStage }) {
  const status = snapshot.researchStageStatuses[stage];
  const outputCount = stageOutputCount(snapshot, stage);
  const state = syncTileStateFromStage(status, outputCount);

  return (
    <div className={`dataset-sync-tile sync-state-${state}`}>
      <span className="sync-tile-name">{RESEARCH_STAGE_TITLES[stage]}</span>
      <p className="sync-tile-description">{RESEARCH_STAGE_DESCRIPTIONS[stage]}</p>
      <dl className="sync-tile-times">
        <dt>Status</dt>
        <dd>
          <ResearchStageStatusValue outputCount={outputCount} state={state} status={status} />
        </dd>
        <dt>Last</dt>
        <dd>
          <LocalDateTime value={stageLastRunAt(status)} fallback="Not run yet" />
        </dd>
        <dt>Next scheduled</dt>
        <dd>
          <LocalDateTime value={nextResearchStageRunIso(stage)} />
        </dd>
        <dt>Scope</dt>
        <dd>{stageScopeText(snapshot, stage)}</dd>
        <dt>{stageOutputLabel(stage)}</dt>
        <dd>{formatNumber(outputCount)}</dd>
        <dt>{stageDurationLabel(status)}</dt>
        <dd>{formatDuration(stageDurationMs(status))}</dd>
      </dl>
      <ResearchTileChecks ariaLabel={`${RESEARCH_STAGE_TITLES[stage]} details`} checks={stageDetailChecks(snapshot, stage, status)} />
    </div>
  );
}

function ResearchWorkSync({ snapshot }: { snapshot: ResearchSnapshot }) {
  const cycleState = syncTileStateFromResearch(snapshot.researchStatus, snapshot);

  return (
    <section className={`backtest-card sync-card researchSyncCard sync-state-${cycleState}`}>
      <div className="backtest-card-head">
        <div>
          <h2>Research Work</h2>
          <p>Research stages now run once a day in separated windows and record last run, completed jobs, and duration.</p>
        </div>
        <span className={`status ${cycleState === "failed" ? "failed" : cycleState === "success" ? "sent" : "skipped"}`}>
          {cycleState === "failed" ? "error" : cycleState === "success" ? "success" : cycleState === "running" ? "active" : "idle"}
        </span>
      </div>
      <div className="sync-grid" aria-label="Research work sync status">
        {RESEARCH_STAGE_ORDER.map((stage) => (
          <ResearchStageTile key={stage} snapshot={snapshot} stage={stage} />
        ))}
      </div>
    </section>
  );
}

export default async function ResearchPage() {
  const [snapshot, assetOptions] = await Promise.all([getResearchSnapshot(), readResearchAssetOptions()]);
  const newIdeas = [...snapshot.inboxIdeas].sort((left, right) => ideaTime(right) - ideaTime(left)).slice(0, 12);
  const formalizedIdeas = [...snapshot.approvedIdeas].sort((left, right) => ideaTime(right) - ideaTime(left)).slice(0, 12);
  const ideaToCodeInputs = snapshot.approvedIdeas;
  const backtestInputRows = snapshot.belowRequirementRows;

  return (
    <main className="terminal">
      <AutoRefresh intervalMs={60_000} />
      <AutoTradeAccountGate />
      <section className="terminal-workspace marketView researchWorkspace" id="research">
        <div className="marketTopShell researchTopShell">
          <div className="marketTopRow">
            <AutoTradeAccountModeSwitch />
            <Link className="autoTradeResearchLink marketTopNavLink" href="/">
              Main Page
            </Link>
          </div>
        </div>

        <header className="terminal-head researchTerminalHead">
          <div className="asset-meta">
            <p className="terminal-kicker">Research</p>
            <h1>Research</h1>
            <span>{currentActivity(snapshot)}</span>
          </div>
          <div className="terminal-actions">
            <ThemeToggle />
          </div>
        </header>

        <section className="backtest-card researchBoardCard" id="idea-discovery">
          <div className="backtest-card-head">
            <div>
              <h2>Idea Discovery</h2>
              <p>Drop raw strategy notes, links, or loose market observations here before formalization.</p>
            </div>
            <span className={`count-pill${snapshot.inboxIdeaCount > 0 ? " warning" : ""}`}>
              {formatNumber(snapshot.inboxIdeaCount)} new
            </span>
          </div>
          <div className="researchConversionGrid">
            <div className={`researchLane collecting ${laneState(1)}`}>
              <div className="researchLaneHead">
                <span>Manual intake</span>
                <strong>Raw idea input</strong>
              </div>
              <ResearchIdeaForm isEmpty={snapshot.inboxIdeaCount === 0} />
            </div>
            <div className={`researchLane finished ${laneState(newIdeas.length)}`}>
              <div className="researchLaneHead">
                <span>Output from this stage</span>
                <strong>New ideas</strong>
              </div>
              <ResearchIdeaList assets={assetOptions} editable empty="No new ideas discovered yet." ideas={newIdeas} mode="discovery" />
            </div>
          </div>
        </section>

        <section className="backtest-card researchBoardCard" id="idea-formalization">
          <div className="backtest-card-head">
            <div>
              <h2>Idea Formalization</h2>
              <p>Left side keeps the raw discovery queue; right side shows structured, editable research plans.</p>
            </div>
            <span className={`count-pill${snapshot.approvedIdeaCount > 0 ? "" : " warning"}`}>
              {formatNumber(snapshot.approvedIdeaCount)} formalized
            </span>
          </div>
          <div className="researchConversionGrid">
            <div className={`researchLane collecting ${laneState(newIdeas.length)}`}>
              <div className="researchLaneHead">
                <span>Input to this stage</span>
                <strong>New ideas</strong>
              </div>
              <ResearchIdeaList assets={assetOptions} editable empty="No new ideas are waiting for formalization." ideas={newIdeas} mode="discovery" />
            </div>
            <div className={`researchLane finished ${laneState(formalizedIdeas.length)}`}>
              <div className="researchLaneHead">
                <span>Output from this stage</span>
                <strong>Formalized ideas</strong>
              </div>
              <ResearchIdeaList assets={assetOptions} editable empty="No formalized ideas yet." ideas={formalizedIdeas} mode="formalization" />
            </div>
          </div>
        </section>

        <section className="backtest-card researchConversion">
          <div className="backtest-card-head">
            <div>
              <h2>Formalized Ideas To Coded Strategies</h2>
              <p>Left side collects formalized research plans; right side shows coded strategy specs that are ready to backtest.</p>
            </div>
            <span className="count-pill">{formatNumber(snapshot.readyCount)} coded</span>
          </div>
          <div className="researchConversionGrid">
            <div className={`researchLane collecting ${laneState(ideaToCodeInputs.length)}`}>
              <div className="researchLaneHead">
                <span>Input to this stage</span>
                <strong>Formalized ideas</strong>
              </div>
              <ResearchIdeaList assets={assetOptions} editable empty="No formalized ideas are ready to code." ideas={ideaToCodeInputs} mode="formalization" />
            </div>
            <div className={`researchLane finished ${laneState(snapshot.readySpecs.length)}`}>
              <div className="researchLaneHead">
                <span>Output from this stage</span>
                <strong>Coded strategies</strong>
              </div>
              <ResearchStrategyList empty="No coded strategies have been produced yet." specs={snapshot.readySpecs} />
            </div>
          </div>
        </section>

        <section className="backtest-card researchConversion">
          <div className="backtest-card-head">
            <div>
              <h2>Coded Strategies To Backtest Results</h2>
              <p>Left side collects coded strategy folders; right side shows detailed backtest results.</p>
            </div>
            <span className={`count-pill${snapshot.pendingReadyCount > 0 ? " warning" : ""}`}>
              {formatNumber(snapshot.pendingReadyCount)} queued / {formatNumber(snapshot.backtestedCount)} tested
            </span>
          </div>
          <div className="researchConversionGrid">
            <div className={`researchLane collecting ${laneState(snapshot.readySpecs.length)}`}>
              <div className="researchLaneHead">
                <span>Input to this stage</span>
                <strong>Coded strategies</strong>
              </div>
              <ResearchStrategyList empty="No coded strategies waiting for stats." specs={snapshot.readySpecs} />
            </div>
            <div className={`researchLane finished ${laneState(snapshot.backtestedRows.length)}`}>
              <div className="researchLaneHead">
                <span>Output from this stage</span>
                <strong>Backtest results</strong>
              </div>
              <ResearchBacktestTable empty="No backtest results have been produced yet." rows={snapshot.backtestedRows} />
            </div>
          </div>
        </section>

        <section className="backtest-card researchConversion researchFinishedCard">
          <div className="backtest-card-head">
            <div>
              <h2>Backtest Results To Finished Strategies</h2>
              <p>Left side collects backtest results below requirements; right side shows strategies that cleared PF above 2 and more than 20 trades.</p>
            </div>
            <span className={`count-pill${snapshot.qualifiedCount > 0 ? "" : " warning"}`}>
              {formatNumber(snapshot.qualifiedCount)} finished
            </span>
          </div>
          <div className="researchConversionGrid">
            <div className={`researchLane collecting ${laneState(backtestInputRows.length)}`}>
              <div className="researchLaneHead">
                <span>Still under review</span>
                <strong>Backtest results</strong>
              </div>
              <ResearchBacktestTable empty="No backtest results are waiting for final review." rows={backtestInputRows} />
            </div>
            <div className={`researchLane finished ${laneState(snapshot.finishedRows.length)}`}>
              <div className="researchLaneHead">
                <span>Cleared requirements</span>
                <strong>Finished strategies</strong>
              </div>
              <ResearchBacktestTable empty={`No strategy has cleared PF >= ${RESEARCH_FINISHED_MIN_PF} with enough trades yet.`} rows={snapshot.finishedRows} />
            </div>
          </div>
        </section>

        <ResearchWorkSync snapshot={snapshot} />
      </section>
    </main>
  );
}
