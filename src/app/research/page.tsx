import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import AutoTradeAccountGate from "@/components/auto-trading/auto-trade-account-gate";
import AutoTradeAccountModeSwitch from "@/components/auto-trading/auto-trade-account-mode-switch";
import ResearchIdeaForm, { type ResearchAssetOption } from "@/components/research/research-idea-form";
import AutoRefresh from "@/components/ui/auto-refresh";
import LocalDateTime from "@/components/ui/local-date-time";
import ThemeToggle from "@/components/ui/theme-toggle";
import { getDatasetStatus } from "@/lib/live-config";

export const dynamic = "force-dynamic";

const RESEARCH_ROOT = path.join(process.cwd(), "Research");
const ASSETS_PATH = path.join(process.cwd(), "config", "assets.json");
const RESEARCH_STATUS_PATH = path.join(RESEARCH_ROOT, "runtime", "research-cycle-status.json");
const HIDDEN_ENTRY_NAMES = new Set([".gitkeep"]);
const RESEARCH_CRON_STAGE_MINUTES_UTC = [0, 10, 20, 30];
const RESEARCH_CRON_STAGE_HOURS_UTC = [0, 6, 12, 18];

type ResearchIdea = {
  createdAt?: string;
  engines?: string[];
  hypothesis?: string;
  ideaId?: string;
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

type ResearchSnapshot = {
  approvedIdeas: ResearchIdea[];
  approvedIdeaCount: number;
  backtestedCount: number;
  candidateRows: BacktestRow[];
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
  values.forEach((value) => {
    if (value) parsedValues.push(value);
  });
  return parsedValues;
}

function ideaTime(value: ResearchIdea) {
  const timestamp = value.createdAt ? new Date(value.createdAt).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function readStrategySpecs(relativePath: string, limit: number) {
  const folders = await listDirectoryNames(relativePath);
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

async function readResearchCycleStatus(): Promise<ResearchCycleStatus> {
  const datasetStatus = await getDatasetStatus().catch(() => null);
  const researchCycle = datasetStatus?.sync?.researchCycle;
  if (researchCycle) {
    return {
      ...researchCycle,
      lastSuccessAt: datasetStatus?.sync?.lastResearchCycleAt
    };
  }
  return readJsonFile<NonNullable<ResearchCycleStatus>>(RESEARCH_STATUS_PATH);
}

async function getResearchSnapshot(): Promise<ResearchSnapshot> {
  const readyFolders = await listDirectoryNames("strategies/ready_to_backtest");
  const backtestedFolders = await listDirectoryNames("strategies/backtested");
  const qualifiedFolders = await listDirectoryNames("strategies/qualified");
  const backtestedIds = new Set(backtestedFolders);
  const candidateRows = (await readBacktestSummary()).sort((left, right) => Number(right.profit_factor) - Number(left.profit_factor));
  const inboxIdeas = (await readJsonFiles<ResearchIdea>("ideas/inbox", 8)).sort((left, right) => ideaTime(right) - ideaTime(left));
  const approvedIdeas = (await readJsonFiles<ResearchIdea>("ideas/approved", 10)).sort((left, right) => ideaTime(right) - ideaTime(left));

  return {
    approvedIdeas,
    approvedIdeaCount: await countFiles("ideas/approved", ".json"),
    backtestedCount: backtestedFolders.length,
    candidateRows: candidateRows.slice(0, 10),
    finishedRows: candidateRows.filter((row) => row.qualified === "True").slice(0, 10),
    fetchedPagesCount: await countFiles("sources/pages", ".json"),
    inboxIdeaCount: await countFiles("ideas/inbox", ".json"),
    inboxIdeas,
    latestReport: await readLatestReport(),
    pendingReadyCount: readyFolders.filter((folder) => !backtestedIds.has(folder)).length,
    qualifiedCount: qualifiedFolders.length,
    readyCount: readyFolders.length,
    readySpecs: await readStrategySpecs("strategies/ready_to_backtest", 10),
    researchStatus: await readResearchCycleStatus(),
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

function formatDate(value: Date | string | undefined) {
  if (!value) return "n/a";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/Los_Angeles"
  }).format(date);
}

function formatDuration(ms: number | undefined) {
  if (!ms || !Number.isFinite(ms)) return "n/a";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function nextResearchCronRunIso(now = new Date()) {
  const candidates: Date[] = [];
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const hour of RESEARCH_CRON_STAGE_HOURS_UTC) {
      for (const minute of RESEARCH_CRON_STAGE_MINUTES_UTC) {
        const candidate = new Date(now);
        candidate.setUTCDate(now.getUTCDate() + dayOffset);
        candidate.setUTCHours(hour, minute, 0, 0);
        if (candidate > now) candidates.push(candidate);
      }
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

function syncTileStateFromResearch(status: ResearchCycleStatus, snapshot: ResearchSnapshot): "failed" | "running" | "success" {
  if (status?.state === "failed") return "failed";
  if (status?.state === "running") return "running";
  if (status?.state === "success" || snapshot.reportCount > 0 || snapshot.readyCount > 0 || snapshot.backtestedCount > 0) return "success";
  return "running";
}

function IdeaList({ empty, ideas }: { empty: string; ideas: ResearchIdea[] }) {
  if (!ideas.length) {
    return (
      <div className="researchEmptyMini">
        <strong>{empty}</strong>
      </div>
    );
  }

  return (
    <div className="researchIdeaGrid compact">
      {ideas.map((idea) => (
        <article className={`researchIdea ${idea.status === "approved" ? "approved" : "inbox"}`} key={`${idea.status}-${idea.ideaId ?? idea.title}`}>
          <div>
            <span>{idea.status === "approved" ? "Approved" : "Inbox"} / {idea.provenance ?? "research"}</span>
            <strong>{idea.title ?? idea.ideaId ?? "Untitled idea"}</strong>
          </div>
          <p>{idea.hypothesis ?? "No hypothesis text recorded."}</p>
          <div className="researchIdeaMeta">
            <span>{(idea.timeframes ?? []).join(" / ") || "timeframe pending"}</span>
            <span>{(idea.engines ?? []).join(" / ") || "engine pending"}</span>
            <span>{formatDate(idea.createdAt)}</span>
          </div>
        </article>
      ))}
    </div>
  );
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

function BacktestTable({ empty, rows, showGate = false }: { empty: string; rows: BacktestRow[]; showGate?: boolean }) {
  if (!rows.length) {
    return (
      <div className="researchEmptyMini">
        <strong>{empty}</strong>
      </div>
    );
  }

  return (
    <div className="terminal-table-wrap compact researchLaneTable">
      <table className="terminal-table researchTable">
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

function ResearchWorkSync({ snapshot }: { snapshot: ResearchSnapshot }) {
  const status = snapshot.researchStatus;
  const cycleState = syncTileStateFromResearch(status, snapshot);
  const nextRunAt = nextResearchCronRunIso();
  const pipelineState = snapshot.pendingReadyCount > 0 ? "running" : snapshot.qualifiedCount > 0 || snapshot.backtestedCount > 0 ? "success" : "running";
  const reportState = snapshot.latestReport ? "success" : snapshot.backtestedCount > 0 ? "running" : "failed";

  return (
    <section className={`backtest-card sync-card researchSyncCard sync-state-${cycleState}`}>
      <div className="backtest-card-head">
        <div>
          <h2>Research Work</h2>
          <p>LLM research and idea/coding stages run every 6 hours; backtest and finished gates stay deterministic.</p>
        </div>
        <span className={`status ${cycleState === "failed" ? "failed" : cycleState === "success" ? "sent" : "skipped"}`}>
          {cycleState === "failed" ? "error" : cycleState === "success" ? "success" : "active"}
        </span>
      </div>
      <div className="sync-grid" aria-label="Research work sync status">
        <div className={`dataset-sync-tile sync-state-${cycleState}`}>
          <span className="sync-tile-name">Research cycle</span>
          <dl className="sync-tile-times">
            <dt>Status</dt>
            <dd>{status?.state === "failed" ? status.error ?? "Failed" : status?.state ?? "No run yet"}</dd>
            <dt>Stage</dt>
            <dd>{status?.stage ?? "pipeline"}</dd>
            <dt>Last start</dt>
            <dd>
              <LocalDateTime value={status?.startedAt} fallback="Not started yet" />
            </dd>
            <dt>Last finish</dt>
            <dd>
              <LocalDateTime value={status?.finishedAt ?? status?.lastSuccessAt} fallback="Not finished yet" />
            </dd>
            <dt>Duration</dt>
            <dd>{formatDuration(status?.durationMs)}</dd>
          </dl>
        </div>
        <div className={`dataset-sync-tile sync-state-${snapshot.inboxIdeaCount || snapshot.approvedIdeaCount ? "success" : "running"}`}>
          <span className="sync-tile-name">Idea intake</span>
          <dl className="sync-tile-times">
            <dt>Status</dt>
            <dd>{snapshot.inboxIdeaCount ? "Collecting" : snapshot.approvedIdeaCount ? "Approved" : "Waiting"}</dd>
            <dt>Inbox</dt>
            <dd>{formatNumber(snapshot.inboxIdeaCount)}</dd>
            <dt>Approved</dt>
            <dd>{formatNumber(snapshot.approvedIdeaCount)}</dd>
            <dt>Search files</dt>
            <dd>{formatNumber(snapshot.searchResultCount)}</dd>
          </dl>
        </div>
        <div className={`dataset-sync-tile sync-state-${pipelineState}`}>
          <span className="sync-tile-name">Pipeline</span>
          <dl className="sync-tile-times">
            <dt>Status</dt>
            <dd>{snapshot.pendingReadyCount > 0 ? "Backtest queue open" : snapshot.backtestedCount > 0 ? "Backtested" : "Building"}</dd>
            <dt>Coded</dt>
            <dd>{formatNumber(snapshot.readyCount)}</dd>
            <dt>Queued</dt>
            <dd>{formatNumber(snapshot.pendingReadyCount)}</dd>
            <dt>Backtested</dt>
            <dd>{formatNumber(snapshot.backtestedCount)}</dd>
          </dl>
        </div>
        <div className={`dataset-sync-tile sync-state-${reportState}`}>
          <span className="sync-tile-name">Finished results</span>
          <dl className="sync-tile-times">
            <dt>Status</dt>
            <dd>{snapshot.qualifiedCount > 0 ? "Qualified" : snapshot.reportCount > 0 ? "Report ready" : "No report"}</dd>
            <dt>Qualified</dt>
            <dd>{formatNumber(snapshot.qualifiedCount)}</dd>
            <dt>Latest report</dt>
            <dd>
              <LocalDateTime value={snapshot.latestReport?.updatedAt.toISOString()} fallback="No report yet" />
            </dd>
            <dt>Next scheduled</dt>
            <dd>
              <LocalDateTime value={nextRunAt} />
            </dd>
          </dl>
        </div>
      </div>
    </section>
  );
}

export default async function ResearchPage() {
  const [snapshot, assetOptions] = await Promise.all([getResearchSnapshot(), readResearchAssetOptions()]);
  const ideaBoardIdeas = [...snapshot.inboxIdeas, ...snapshot.approvedIdeas].sort((left, right) => ideaTime(right) - ideaTime(left)).slice(0, 12);
  const ideaToCodeInputs = snapshot.approvedIdeas.length ? snapshot.approvedIdeas : snapshot.inboxIdeas;
  const backtestInputRows = snapshot.candidateRows.filter((row) => row.qualified !== "True");

  return (
    <main className="terminal">
      <AutoRefresh intervalMs={60_000} />
      <AutoTradeAccountGate />
      <section className="terminal-workspace marketView researchWorkspace" id="research">
        <div className="marketTopShell researchTopShell">
          <AutoTradeAccountModeSwitch />
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
            <div className={`researchLane collecting ${laneState(snapshot.inboxIdeaCount + snapshot.approvedIdeaCount)}`}>
              <div className="researchLaneHead">
                <span>Collecting</span>
                <strong>New ideas</strong>
              </div>
              <ResearchIdeaForm assets={assetOptions} />
            </div>
            <div className={`researchLane finished ${laneState(ideaBoardIdeas.length)}`}>
              <div className="researchLaneHead">
                <span>Finished</span>
                <strong>Idea Board output</strong>
              </div>
              <IdeaList empty="No ideas on the board yet." ideas={ideaBoardIdeas} />
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
              <IdeaList empty="No approved or inbox ideas are waiting." ideas={ideaToCodeInputs} />
            </div>
            <div className={`researchLane finished ${laneState(snapshot.readySpecs.length)}`}>
              <div className="researchLaneHead">
                <span>Finished by this stage</span>
                <strong>Coded strategies</strong>
              </div>
              <StrategyList empty="No coded strategies finished yet." specs={snapshot.readySpecs} />
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
            <div className={`researchLane finished ${laneState(snapshot.candidateRows.length)}`}>
              <div className="researchLaneHead">
                <span>Finished by this stage</span>
                <strong>Backtested stats</strong>
              </div>
              <BacktestTable empty="No backtested stats finished yet." rows={snapshot.candidateRows} showGate />
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
            <div className={`researchLane collecting ${laneState(backtestInputRows.length || snapshot.candidateRows.length)}`}>
              <div className="researchLaneHead">
                <span>Collecting from previous output</span>
                <strong>Backtested stats</strong>
              </div>
              <BacktestTable empty="No backtested stats are ready for final review." rows={backtestInputRows.length ? backtestInputRows : snapshot.candidateRows} showGate />
            </div>
            <div className={`researchLane finished ${laneState(snapshot.finishedRows.length)}`}>
              <div className="researchLaneHead">
                <span>Finished by this stage</span>
                <strong>Finished strategies</strong>
              </div>
              <BacktestTable empty="No finished PF > 2 result yet." rows={snapshot.finishedRows} />
              {snapshot.latestReport ? (
                <div className="researchReportExcerpt">
                  {snapshot.latestReport.lines.map((line) => (
                    <span key={line}>{line.replaceAll("|", " / ")}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <ResearchWorkSync snapshot={snapshot} />

        <nav className="researchBottomNav" aria-label="Research footer navigation">
          <Link className="terminal-action" href="/">
            Back to Main Page
          </Link>
        </nav>
      </section>
    </main>
  );
}
