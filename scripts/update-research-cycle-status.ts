import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { updateDatasetSyncRunStatus, type ResearchStageKey, type SyncRunState } from "../src/lib/live-config";

const RESEARCH_ROOT = path.join(process.cwd(), "Research");
const JOB_COUNT_GRACE_MS = 60_000;

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function stateArg(): SyncRunState {
  const raw = argValue("state");
  if (raw === "idle" || raw === "running" || raw === "success" || raw === "failed") return raw;
  throw new Error("Pass --state=running, --state=success, or --state=failed.");
}

function validIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function researchStageArg(): ResearchStageKey | undefined {
  const raw = argValue("stage");
  if (raw === "research" || raw === "idea" || raw === "coding" || raw === "backtest") return raw;
  return undefined;
}

async function countRecentFiles(relativePath: string, sinceMs: number, fileName?: string) {
  const root = path.join(RESEARCH_ROOT, relativePath);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const counts = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("_") && entry.name !== ".gitkeep")
        .map(async (entry) => {
          const entryPath = path.join(root, entry.name);
          const targetPath = fileName && entry.isDirectory() ? path.join(entryPath, fileName) : entryPath;
          try {
            const info = await stat(targetPath);
            if (info.isFile() && info.mtimeMs >= sinceMs - JOB_COUNT_GRACE_MS) return 1;
          } catch {
            return 0;
          }
          return 0;
        })
    );
    return counts.reduce<number>((total, count) => total + count, 0);
  } catch {
    return 0;
  }
}

async function jobsLastRun(stage: ResearchStageKey | undefined, startedAt: string) {
  if (!stage) return undefined;
  const sinceMs = Date.parse(startedAt);
  if (!Number.isFinite(sinceMs)) return undefined;

  if (stage === "research") return countRecentFiles("ideas/inbox", sinceMs);
  if (stage === "idea") return countRecentFiles("ideas/approved", sinceMs);
  if (stage === "coding") return countRecentFiles("strategies/ready_to_backtest", sinceMs, "strategy.json");
  return countRecentFiles("strategies/backtested", sinceMs, "strategy.json");
}

async function main() {
  const state = stateArg();
  const startedAt = validIso(argValue("started-at")) ?? new Date().toISOString();
  const finishedAt = state === "running" ? undefined : new Date().toISOString();
  const durationMs = finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : undefined;
  const error = state === "failed" ? argValue("error") || "Research workflow failed." : undefined;
  const stage = researchStageArg();
  const jobs = state === "running" ? undefined : await jobsLastRun(stage, startedAt);

  await updateDatasetSyncRunStatus("researchCycle", {
    durationMs,
    error,
    finishedAt,
    jobsLastRun: jobs,
    stage,
    startedAt,
    state
  });

  console.log(`researchCycle status updated to ${state}${stage ? ` for ${stage}` : ""}${jobs === undefined ? "" : ` with ${jobs} job(s)`}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
