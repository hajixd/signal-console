import { getBacktestCatalogFreshness } from "@/lib/backtest";

const WORKFLOW_FILE = "refresh-backtests.yml";
const DEFAULT_MAX_AGE_HOURS = 12;
const DISPATCH_THROTTLE_MS = 60 * 60 * 1000;

let lastStaleDispatchAt = 0;

type RefreshDispatchResult = {
  body: Record<string, unknown>;
  ok: boolean;
  status: number;
};

type RefreshConfigStatus = {
  configured: boolean;
  missing: string[];
  owner?: string;
  ref?: string;
  repo?: string;
  workflow: string;
};

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
    ref: envValue("GITHUB_REFRESH_REF", "VERCEL_GIT_COMMIT_REF") || "main",
    token: envValue("GITHUB_BACKTEST_REFRESH_TOKEN", "GITHUB_REFRESH_TOKEN")
  };
}

export function getBacktestRefreshConfigStatus(): RefreshConfigStatus {
  const config = githubRefreshConfig();
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    configured: missing.length === 0,
    missing,
    owner: config.owner || undefined,
    ref: config.ref || undefined,
    repo: config.repo || undefined,
    workflow: WORKFLOW_FILE
  };
}

function maxRefreshAgeMs(): number {
  const configured = Number(process.env.BACKTEST_AUTO_REFRESH_MAX_AGE_HOURS);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_AGE_HOURS;
  return hours * 60 * 60 * 1000;
}

export async function verifyBacktestRefreshWorkflowAccess(): Promise<RefreshDispatchResult> {
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
    `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${WORKFLOW_FILE}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "User-Agent": "signal-console-vercel-admin",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    }
  );

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      status: response.status,
      body: {
        error: "GitHub workflow access check failed",
        details: text || response.statusText
      }
    };
  }

  const workflow = (await response.json()) as { name?: string; path?: string; state?: string };
  return {
    ok: true,
    status: 200,
    body: {
      owner: config.owner,
      repo: config.repo,
      ref: config.ref,
      workflow: WORKFLOW_FILE,
      workflowName: workflow.name,
      workflowPath: workflow.path,
      workflowState: workflow.state
    }
  };
}

export async function dispatchBacktestRefresh(reason = "manual"): Promise<RefreshDispatchResult> {
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
      reason,
      repo: config.repo,
      ref: config.ref,
      workflow: WORKFLOW_FILE,
      requestedAt: new Date().toISOString()
    }
  };
}

export async function ensureBacktestHistoryFresh(): Promise<RefreshDispatchResult | null> {
  const freshness = await getBacktestCatalogFreshness();
  const generatedAt = freshness.generatedAt ? Date.parse(freshness.generatedAt) : 0;
  const stale = !generatedAt || Date.now() - generatedAt > maxRefreshAgeMs();

  if (!stale) return null;
  if (Date.now() - lastStaleDispatchAt < DISPATCH_THROTTLE_MS) {
    return {
      ok: true,
      status: 202,
      body: {
        dispatched: false,
        reason: "stale-backtest-manifest",
        skipped: "Recent refresh dispatch already requested"
      }
    };
  }
  lastStaleDispatchAt = Date.now();
  return dispatchBacktestRefresh("stale-backtest-manifest");
}
