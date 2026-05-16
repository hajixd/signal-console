import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { updateDatasetSyncRunStatus } from "@/lib/live-config";
import { dispatchResearchCycleWorkflow, getResearchGithubConfigStatus } from "@/lib/research-workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const RESEARCH_STATUS_PATH = path.join(process.cwd(), "Research", "runtime", "research-cycle-status.json");

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

async function writeLocalResearchStatus(payload: Record<string, unknown>) {
  await fs.mkdir(path.dirname(RESEARCH_STATUS_PATH), { recursive: true });
  await fs.writeFile(RESEARCH_STATUS_PATH, `${JSON.stringify({ ...payload, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

export async function GET(request: NextRequest) {
  const auth = isAuthorized(request);
  if (auth === "missing-secret") {
    return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500 });
  }
  if (auth === "bad-secret") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get("health") === "1") {
    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      github: getResearchGithubConfigStatus(),
      ok: true,
      route: "/api/cron/research-cycle"
    });
  }

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const limit = boundedInteger(request.nextUrl.searchParams.get("limit"), 25, 1, 250);
  const maxPerIdea = boundedInteger(request.nextUrl.searchParams.get("maxPerIdea"), 3, 1, 50);
  const minTrades = boundedInteger(request.nextUrl.searchParams.get("minTrades"), 21, 1, 5000);
  const minPf = request.nextUrl.searchParams.get("minPf") ?? "2";
  const markets = request.nextUrl.searchParams.get("markets") || "futures,forex";

  const runSettings = {
    limit,
    markets,
    maxPerIdea,
    minPf,
    minTrades
  };

  await Promise.allSettled([
    updateDatasetSyncRunStatus("researchCycle", {
      finishedAt: undefined,
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
    reason: request.nextUrl.searchParams.get("reason") || "vercel-cron",
    startedAt: startedAtIso
  });

  if (dispatch.ok) {
    return NextResponse.json(
      {
        ok: true,
        route: "/api/cron/research-cycle",
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
      route: "/api/cron/research-cycle"
    },
    { status: dispatch.status || 500 }
  );
}

export async function POST(request: NextRequest) {
  return GET(request);
}
