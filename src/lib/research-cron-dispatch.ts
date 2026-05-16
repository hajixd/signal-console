import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { updateDatasetSyncRunStatus } from "@/lib/live-config";
import { dispatchResearchCycleWorkflow, getResearchGithubConfigStatus } from "@/lib/research-workflow";

export type ResearchStage = "research" | "idea" | "coding" | "backtest" | "pipeline";

const RESEARCH_STATUS_PATH = path.join(process.cwd(), "Research", "runtime", "research-cycle-status.json");
const RESEARCH_STAGE_STATUS_PATH = path.join(process.cwd(), "Research", "runtime", "research-stage-status.json");
const STAGES = new Set<ResearchStage>(["research", "idea", "coding", "backtest", "pipeline"]);
const TRACKED_STAGES = new Set<ResearchStage>(["research", "idea", "coding", "backtest"]);

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function stageValue(value: string | null, fallback: ResearchStage): ResearchStage {
  return value && STAGES.has(value as ResearchStage) ? (value as ResearchStage) : fallback;
}

function routeForStage(stage: ResearchStage) {
  if (stage === "idea") return "/api/cron/research-ideas";
  return `/api/cron/research-${stage}`;
}

async function writeLocalResearchStatus(payload: Record<string, unknown>) {
  const updatedAt = new Date().toISOString();
  const normalizedPayload = { ...payload, updatedAt };
  await fs.mkdir(path.dirname(RESEARCH_STATUS_PATH), { recursive: true });
  await fs.writeFile(RESEARCH_STATUS_PATH, `${JSON.stringify(normalizedPayload, null, 2)}\n`, "utf8");

  const stage = typeof payload.stage === "string" && TRACKED_STAGES.has(payload.stage as ResearchStage) ? payload.stage : undefined;
  if (!stage) return;

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(RESEARCH_STAGE_STATUS_PATH, "utf8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }

  await fs.writeFile(
    RESEARCH_STAGE_STATUS_PATH,
    `${JSON.stringify({ ...existing, [stage]: normalizedPayload }, null, 2)}\n`,
    "utf8"
  );
}

export async function handleResearchCron(request: NextRequest, defaultStage: ResearchStage) {
  const auth = isAuthorized(request);
  if (auth === "missing-secret") {
    return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500 });
  }
  if (auth === "bad-secret") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stage = stageValue(request.nextUrl.searchParams.get("stage"), defaultStage);
  if (request.nextUrl.searchParams.get("health") === "1") {
    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      github: getResearchGithubConfigStatus(),
      ok: true,
      route: routeForStage(stage),
      stage
    });
  }

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const limit = boundedInteger(request.nextUrl.searchParams.get("limit"), stage === "backtest" ? 50 : 25, 1, 250);
  const maxPerIdea = boundedInteger(request.nextUrl.searchParams.get("maxPerIdea"), 3, 1, 50);
  const minTrades = boundedInteger(request.nextUrl.searchParams.get("minTrades"), 21, 1, 5000);
  const minPf = request.nextUrl.searchParams.get("minPf") ?? "2";
  const markets = request.nextUrl.searchParams.get("markets") || "futures,forex";

  const runSettings = {
    limit,
    markets,
    maxPerIdea,
    minPf,
    minTrades,
    stage
  };

  await Promise.allSettled([
    updateDatasetSyncRunStatus("researchCycle", {
      finishedAt: undefined,
      stage,
      startedAt: startedAtIso,
      state: "running"
    }),
    writeLocalResearchStatus({
      ...runSettings,
      startedAt: startedAtIso,
      state: "running"
    })
  ]);

  const dispatch = await dispatchResearchCycleWorkflow({
    limit,
    markets,
    maxPerIdea,
    minPf,
    minTrades,
    reason: request.nextUrl.searchParams.get("reason") || `vercel-cron:${stage}`,
    stage,
    startedAt: startedAtIso
  });

  if (dispatch.ok) {
    return NextResponse.json(
      {
        ok: true,
        route: routeForStage(stage),
        run: {
          ...dispatch.body,
          settings: runSettings
        }
      },
      { status: 202 }
    );
  }

  const durationMs = Date.now() - startedAt;
  const finishedAt = new Date().toISOString();
  const message = typeof dispatch.body.error === "string" ? dispatch.body.error : "GitHub research workflow dispatch failed";
  await Promise.allSettled([
    updateDatasetSyncRunStatus("researchCycle", {
      durationMs,
      error: message,
      finishedAt,
      stage,
      startedAt: startedAtIso,
      state: "failed"
    }),
    writeLocalResearchStatus({
      ...runSettings,
      dispatch: dispatch.body,
      durationMs,
      error: message,
      finishedAt,
      startedAt: startedAtIso,
      state: "failed"
    })
  ]);
  return NextResponse.json(
    {
      dispatch: dispatch.body,
      durationMs,
      error: message,
      ok: false,
      route: routeForStage(stage),
      stage
    },
    { status: dispatch.status || 500 }
  );
}
