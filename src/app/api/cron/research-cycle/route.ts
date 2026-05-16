import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { updateDatasetSyncRunStatus } from "@/lib/live-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const execFileAsync = promisify(execFile);
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

function clipOutput(value: string) {
  return value.length > 8000 ? `${value.slice(0, 8000)}\n... output clipped ...` : value;
}

async function writeLocalResearchStatus(payload: Record<string, unknown>) {
  await fs.mkdir(path.dirname(RESEARCH_STATUS_PATH), { recursive: true });
  await fs.writeFile(RESEARCH_STATUS_PATH, `${JSON.stringify({ ...payload, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

async function runPythonScript(args: string[]) {
  const pythonBin = process.env.PYTHON_BIN || "python";
  const result = await execFileAsync(pythonBin, args, {
    cwd: process.cwd(),
    maxBuffer: 5 * 1024 * 1024,
    timeout: 285_000,
    windowsHide: true
  });
  return {
    command: `${pythonBin} ${args.join(" ")}`,
    stderr: clipOutput(result.stderr ?? ""),
    stdout: clipOutput(result.stdout ?? "")
  };
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

  try {
    const cycle = await runPythonScript([
      "Research/scripts/research_center.py",
      "local-cycle",
      "--markets",
      markets,
      "--max-per-idea",
      String(maxPerIdea),
      "--min-pf",
      minPf,
      "--min-trades",
      String(minTrades),
      "--limit",
      String(limit)
    ]);
    const report = await runPythonScript(["Research/scripts/generate_report.py", "--top", "20"]);
    const durationMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();
    await Promise.allSettled([
      updateDatasetSyncRunStatus("researchCycle", {
        durationMs,
        error: undefined,
        finishedAt,
        startedAt: startedAtIso,
        state: "success"
      }),
      writeLocalResearchStatus({
        ...runSettings,
        durationMs,
        finishedAt,
        lastSuccessAt: finishedAt,
        startedAt: startedAtIso,
        state: "success"
      })
    ]);
    return NextResponse.json({
      durationMs,
      ok: true,
      report,
      route: "/api/cron/research-cycle",
      run: cycle
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Unknown research cycle error";
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
        durationMs,
        error: message,
        finishedAt,
        startedAt: startedAtIso,
        state: "failed"
      })
    ]);
    console.error("research-cycle cron failed", error);
    return NextResponse.json(
      {
        durationMs,
        error: message,
        ok: false,
        route: "/api/cron/research-cycle"
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
