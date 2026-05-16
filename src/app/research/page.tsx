import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import AutoTradeAccountGate from "@/components/auto-trading/auto-trade-account-gate";
import AutoTradeAccountModeSwitch from "@/components/auto-trading/auto-trade-account-mode-switch";
import ResearchIdeaForm, { type ResearchAssetOption } from "@/components/research/research-idea-form";
import ResearchIdeaList from "@/components/research/research-idea-list";
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
  backtest: "Backtesting",
  coding: "Coding Ideas",
  idea: "Formalization of Ideas",
  research: "New Idea Generation"
} satisfies Record<ResearchStage, string>;
const RESEARCH_STAGE_DESCRIPTIONS = {
  backtest: "Runs coded strategies through the deterministic backtest engine.",
  coding: "Uses the coding LLM to turn formal ideas into executable strategy specs.",
  idea: "Uses the idea LLM to organize raw research into clear testable reports.",
  research: "Uses You.com and LLM research to find new trading ideas online."
} satisfies Record<ResearchStage, string>;
const RESEARCH_STAGE_JOB_LABELS = {
  backtest: "Backtests",
  coding: "Coded",
  idea: "Formalized",
  research: "Ideas"
} satisfies Record<ResearchStage, string>;

type ResearchStage = (typeof RESEARCH_STAGE_ORDER)[number];

type ResearchIdea = {
  assetKeys?: string[];
  createdAt?: string;
  engines?: string[];
  fileId?: string;
  hypothesis?: string;
  ideaId?: string;
  ideaReport?: {
    timeframes?: string[];
  };
  markets?: string[];
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
  ideaId?: string;
  market?: string;
  provenance?: string;
  status?: string;
  strategyId?: string;
  symbol?: string;
  title?: string;
};

type BacktestRow = {
  asset_key: string;
  engine: string;
  market: string;
  profit_factor: string;
  qualified: string;
  status: string;
  strategy_id: string;
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
    folders.slice(0, limit).map((folder) => readJsonFile<StrategySpec>(path.join(RESEARCH_ROOT, relativePath, folder, "strategy.json")))
  );
  return values.filter((value): value is StrategySpec => Boolean(value));
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
      }, {}) as BacktestRow;
    });
  } catch {
    return [];
  }
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
  const candidateRows = (await readBacktestSummary()).sort((left, right) => Number(right.profit_factor) - Number(left.profit_factor));
  const finishedRows = candidateRows.filter(isFinishedBacktestRow);
  const belowRequirementRows = candidateRows.filter((row) => !isFinishedBacktestRow(row));
  const backtestReviewRows = candidateRows.filter((row) => !isFinishedBacktestRow(row) && row.status !== "cached");
  const inboxIdeas = (await readJsonFiles<ResearchIdea>("ideas/inbox", 8)).sort((left, right) => ideaTime(right) - ideaTime(left));
  const approvedIdeas = (await readJsonFiles<ResearchIdea>("ideas/approved", 10)).sort((left, right) => ideaTime(right) - ideaTime(left));
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

function formatMetric(value: string, digits = 2) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(digits) : value || "n/a";
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

function compactId(value: string | undefined) {
  if (!value) return "n/a";
  if (value.length <= 42) return value;
  return `${value.slice(0, 26)}...${value.slice(-8)}`;
}

function currentActivity(snapshot: ResearchSnapshot) {
  if (snapshot.inboxIdeaCount > 0) return `${formatNumber(snapshot.inboxIdeaCount)} idea${snapshot.inboxIdeaCount === 1 ? "" : "s"} waiting on the idea board`;
  if (snapshot.pendingReadyCount > 0) return `${formatNumber(snapshot.pendingReadyCount)} coded strateg${snapshot.pendingReadyCount === 1 ? "y" : "ies"} waiting for backtests`;
  if (snapshot.qualifiedCount > 0) return `${formatNumber(snapshot.qualifiedCount)} finished strateg${snapshot.qualifiedCount === 1 ? "y" : "ies"} cleared the PF gate`;
  if (snapshot.backtestedCount > 0) return "Backtested stats are waiting for a finished PF > 2 result";
  if (snapshot.readyCount > 0) return "Coded strategies are staged for the next backtest pass";
  if (snapshot.approvedIdeaCount > 0) return "Approved ideas are waiting to become coded strategies";
  return "Research intake is ready for new ideas";
}

function laneState(count: number) {
  return count > 0 ? "active" : "inactive";
}

type SyncTileState = "failed" | "idle" | "running" | "success";

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

function stageStatusText(status: ResearchStageStatus | undefined, outputCount: number) {
  if (status?.state === "failed") return status.error ?? "Error";
  if (status?.state === "running") return "Active";
  if (status?.state === "success" || status?.finishedAt) return "Recent success";
  if (outputCount > 0) return "Output available";
  return "No run yet";
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

function StrategyList({ empty, specs }: { empty: string; specs: StrategySpec[] }) {
  if (!specs.length) {
    return (
      <div className="researchEmptyMini">
        <strong>{empty}</strong>
      </div>
    );
  }

  return (
    <div className="researchMiniList">
      {specs.map((spec) => (
        <div className="researchMiniRow" key={spec.strategyId ?? spec.title}>
          <strong>{compactId(spec.strategyId)}</strong>
          <span>{spec.title ?? "Untitled coded strategy"}</span>
          <small>{spec.assetKey ?? spec.symbol ?? "asset pending"} / {spec.market ?? "market pending"} / {spec.engine ?? "engine pending"}</small>
        </div>
      ))}
    </div>
  );
}

function BacktestTable({
  density = "default",
  empty,
  rows,
  showGate = false
}: {
  density?: "default" | "split";
  empty: string;
  rows: BacktestRow[];
  showGate?: boolean;
}) {
  if (!rows.length) {
    return (
      <div className="researchEmptyMini">
        <strong>{empty}</strong>
      </div>
    );
  }

  return (
    <div className={`terminal-table-wrap compact researchLaneTable${density === "split" ? " researchLaneTableSplit" : ""}`}>
      <table className={`terminal-table researchTable${showGate ? " withGate" : ""}`}>
        <thead>
          <tr>
            <th>Strategy</th>
            <th>Asset</th>
            <th>PF</th>
            <th>Trades</th>
            {showGate ? <th>Gate</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className={row.qualified === "True" ? "up-row" : "neutral-row"} key={row.strategy_id}>
              <td className="main-cell" data-label="Strategy">
                <span>{compactId(row.strategy_id)}</span>
                <small>{row.engine}</small>
              </td>
              <td data-label="Asset">{row.asset_key}</td>
              <td data-label="PF">{formatMetric(row.profit_factor, 2)}</td>
              <td data-label="Trades">{formatNumber(Number(row.trades) || 0)}</td>
              {showGate ? (
                <td data-label="Gate">
                  <span className={`status ${row.qualified === "True" ? "sent" : "neutral-row"}`}>
                    {row.qualified === "True" ? "Finished" : "Collecting"}
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
        <dd>{stageStatusText(status, outputCount)}</dd>
        <dt>Last ran</dt>
        <dd>
          <LocalDateTime value={stageLastRunAt(status)} fallback="Not run yet" />
        </dd>
        <dt>Next run</dt>
        <dd>
          <LocalDateTime value={nextResearchStageRunIso(stage)} />
        </dd>
        <dt>Jobs last run</dt>
        <dd>{stageJobsLastRun(status)}</dd>
        <dt>{RESEARCH_STAGE_JOB_LABELS[stage]} now</dt>
        <dd>{formatNumber(outputCount)}</dd>
        <dt>{stageDurationLabel(status)}</dt>
        <dd>{formatDuration(stageDurationMs(status))}</dd>
      </dl>
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
  const ideaBoardIdeas = [...snapshot.approvedIdeas].sort((left, right) => ideaTime(right) - ideaTime(left)).slice(0, 12);
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

        <section className="backtest-card researchBoardCard" id="idea-board">
          <div className="backtest-card-head">
            <div>
              <h2>Idea Board</h2>
              <p>Add or inspect strategy ideas before they enter the coded-strategy pipeline.</p>
            </div>
            <span className={`count-pill${snapshot.inboxIdeaCount > 0 ? " warning" : ""}`}>
              {formatNumber(snapshot.inboxIdeaCount)} inbox / {formatNumber(snapshot.approvedIdeaCount)} approved
            </span>
          </div>
          <div className="researchConversionGrid">
            <div className={`researchLane collecting ${laneState(snapshot.inboxIdeaCount)}`}>
              <div className="researchLaneHead">
                <span>Collecting</span>
                <strong>New ideas</strong>
              </div>
              <ResearchIdeaForm assets={assetOptions} isEmpty={snapshot.inboxIdeaCount + snapshot.approvedIdeaCount === 0} />
              <ResearchIdeaList assets={assetOptions} empty="No new ideas queued." ideas={newIdeas} />
            </div>
            <div className={`researchLane finished ${laneState(ideaBoardIdeas.length)}`}>
              <div className="researchLaneHead">
                <span>Finished</span>
                <strong>Idea Board output</strong>
              </div>
              <ResearchIdeaList assets={assetOptions} empty="No formalized ideas yet." ideas={ideaBoardIdeas} />
            </div>
          </div>
        </section>

        <section className="backtest-card researchConversion">
          <div className="backtest-card-head">
            <div>
              <h2>From Idea To Coded Strategy</h2>
              <p>Left side collects idea-board output; right side shows coded strategy specs that are ready to backtest.</p>
            </div>
            <span className="count-pill">{formatNumber(snapshot.readyCount)} coded</span>
          </div>
          <div className="researchConversionGrid">
            <div className={`researchLane collecting ${laneState(ideaToCodeInputs.length)}`}>
              <div className="researchLaneHead">
                <span>Collecting from previous output</span>
                <strong>Ideas ready to code</strong>
              </div>
              <ResearchIdeaList assets={assetOptions} empty="No formalized ideas are ready to code." ideas={ideaToCodeInputs} />
            </div>
            <div className={`researchLane finished ${laneState(snapshot.readySpecs.length)}`}>
              <div className="researchLaneHead">
                <span>Finished by this stage</span>
                <strong>Coded strategies</strong>
              </div>
              <StrategyList empty="No coded strategies have been produced yet." specs={snapshot.readySpecs} />
            </div>
          </div>
        </section>

        <section className="backtest-card researchConversion">
          <div className="backtest-card-head">
            <div>
              <h2>From Coded Strategy To Backtested Stats</h2>
              <p>Left side collects coded strategy folders; right side shows finished backtest stats.</p>
            </div>
            <span className={`count-pill${snapshot.pendingReadyCount > 0 ? " warning" : ""}`}>
              {formatNumber(snapshot.pendingReadyCount)} queued / {formatNumber(snapshot.backtestedCount)} tested
            </span>
          </div>
          <div className="researchConversionGrid">
            <div className={`researchLane collecting ${laneState(snapshot.readySpecs.length)}`}>
              <div className="researchLaneHead">
                <span>Collecting from previous output</span>
                <strong>Coded strategies</strong>
              </div>
              <StrategyList empty="No coded strategies waiting for stats." specs={snapshot.readySpecs} />
            </div>
            <div className={`researchLane finished ${laneState(snapshot.backtestedRows.length)}`}>
              <div className="researchLaneHead">
                <span>Finished by this stage</span>
                <strong>Backtested stats</strong>
              </div>
              <BacktestTable empty="No backtested stats have been produced yet." rows={snapshot.backtestedRows} showGate />
            </div>
          </div>
        </section>

        <section className="backtest-card researchConversion researchFinishedCard">
          <div className="backtest-card-head">
            <div>
              <h2>From Backtested To Finished</h2>
              <p>Left side collects backtested stats; right side shows finished strategies that cleared PF above 2 and more than 20 trades.</p>
            </div>
            <span className={`count-pill${snapshot.qualifiedCount > 0 ? "" : " warning"}`}>
              {formatNumber(snapshot.qualifiedCount)} finished
            </span>
          </div>
          <div className="researchConversionGrid">
            <div className={`researchLane collecting ${laneState(backtestInputRows.length)}`}>
              <div className="researchLaneHead">
                <span>Collecting from previous output</span>
                <strong>Backtested stats</strong>
              </div>
              <BacktestTable empty="No backtested stats are waiting for final review." rows={backtestInputRows} showGate />
            </div>
            <div className={`researchLane finished ${laneState(snapshot.finishedRows.length)}`}>
              <div className="researchLaneHead">
                <span>Finished by this stage</span>
                <strong>Finished strategies</strong>
              </div>
              <BacktestTable empty={`No strategy has cleared PF >= ${RESEARCH_FINISHED_MIN_PF} with enough trades yet.`} rows={snapshot.finishedRows} />
            </div>
          </div>
        </section>

        <ResearchWorkSync snapshot={snapshot} />
      </section>
    </main>
  );
}
