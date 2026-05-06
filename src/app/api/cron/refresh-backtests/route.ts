import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const WORKFLOW_FILE = "refresh-backtests.yml";

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

function envValue(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function githubRefreshConfig() {
  return {
    owner: envValue("GITHUB_REFRESH_OWNER", "VERCEL_GIT_REPO_OWNER"),
    repo: envValue("GITHUB_REFRESH_REPO", "VERCEL_GIT_REPO_SLUG"),
    ref: envValue("GITHUB_REFRESH_REF") || "main",
    token: envValue("GITHUB_BACKTEST_REFRESH_TOKEN", "GITHUB_REFRESH_TOKEN")
  };
}

async function dispatchBacktestRefresh() {
  const config = githubRefreshConfig();
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "Missing GitHub workflow dispatch configuration",
        missing
      }
    };
  }

  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "User-Agent": "signal-console-vercel-cron",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({ ref: config.ref })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      status: response.status,
      body: {
        error: "GitHub workflow dispatch failed",
        details: text || response.statusText
      }
    };
  }

  return {
    ok: true,
    status: 202,
    body: {
      dispatched: true,
      owner: config.owner,
      repo: config.repo,
      ref: config.ref,
      workflow: WORKFLOW_FILE,
      requestedAt: new Date().toISOString()
    }
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

  const result = await dispatchBacktestRefresh();
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
