import { updateDatasetSyncRunStatus, type SyncRunState } from "../src/lib/live-config";

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

async function main() {
  const state = stateArg();
  const startedAt = validIso(argValue("started-at")) ?? new Date().toISOString();
  const finishedAt = state === "running" ? undefined : new Date().toISOString();
  const durationMs = finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : undefined;
  const error = state === "failed" ? argValue("error") || "Research workflow failed." : undefined;
  const stage = argValue("stage");

  await updateDatasetSyncRunStatus("researchCycle", {
    durationMs,
    error,
    finishedAt,
    stage,
    startedAt,
    state
  });

  console.log(`researchCycle status updated to ${state}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
