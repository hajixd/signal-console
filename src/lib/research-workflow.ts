const WORKFLOW_FILE = "research-cycle.yml";
const DEFAULT_OWNER = "hajixd";
const DEFAULT_REPO = "signal-console";
const DEFAULT_REF = "publish-main";

type GithubConfig = {
  owner: string;
  ref: string;
  repo: string;
  token: string;
};

type DispatchInputs = {
  limit: number;
  markets: string;
  maxPerIdea: number;
  minPf: string;
  minTrades: number;
  reason: string;
  startedAt: string;
};

export type ResearchGithubResult = {
  body: Record<string, unknown>;
  ok: boolean;
  status: number;
};

function envValue(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function githubResearchConfig(): GithubConfig {
  return {
    owner: envValue("GITHUB_RESEARCH_OWNER", "GITHUB_REFRESH_OWNER", "VERCEL_GIT_REPO_OWNER") || DEFAULT_OWNER,
    ref: envValue("GITHUB_RESEARCH_REF", "GITHUB_REFRESH_REF", "VERCEL_GIT_COMMIT_REF") || DEFAULT_REF,
    repo: envValue("GITHUB_RESEARCH_REPO", "GITHUB_REFRESH_REPO", "VERCEL_GIT_REPO_SLUG") || DEFAULT_REPO,
    token: envValue("GITHUB_RESEARCH_TOKEN", "GITHUB_BACKTEST_REFRESH_TOKEN", "GITHUB_REFRESH_TOKEN")
  };
}

function missingGithubConfig(config: GithubConfig) {
  return Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "signal-console-research",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function readResponseBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { details: text };
  }
}

export function getResearchGithubConfigStatus() {
  const config = githubResearchConfig();
  const missing = missingGithubConfig(config);
  return {
    configured: missing.length === 0,
    missing,
    owner: config.owner,
    ref: config.ref,
    repo: config.repo,
    workflow: WORKFLOW_FILE
  };
}

export async function dispatchResearchCycleWorkflow(inputs: DispatchInputs): Promise<ResearchGithubResult> {
  const config = githubResearchConfig();
  const missing = missingGithubConfig(config);
  if (missing.length) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "Missing GitHub research workflow configuration",
        missing
      }
    };
  }

  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: githubHeaders(config.token),
      body: JSON.stringify({
        inputs: {
          limit: String(inputs.limit),
          markets: inputs.markets,
          maxPerIdea: String(inputs.maxPerIdea),
          minPf: inputs.minPf,
          minTrades: String(inputs.minTrades),
          reason: inputs.reason,
          startedAt: inputs.startedAt
        },
        ref: config.ref
      }),
      cache: "no-store"
    }
  );

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body: {
        error: "GitHub research workflow dispatch failed",
        ...(await readResponseBody(response))
      }
    };
  }

  return {
    ok: true,
    status: 202,
    body: {
      dispatched: true,
      owner: config.owner,
      ref: config.ref,
      repo: config.repo,
      requestedAt: new Date().toISOString(),
      workflow: WORKFLOW_FILE
    }
  };
}

export async function commitResearchIdeaFile(relativePath: string, content: string, title: string): Promise<ResearchGithubResult> {
  const config = githubResearchConfig();
  const missing = missingGithubConfig(config);
  if (missing.length) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "Missing GitHub research idea commit configuration",
        missing
      }
    };
  }

  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(normalizedPath).replaceAll("%2F", "/")}`,
    {
      method: "PUT",
      headers: githubHeaders(config.token),
      body: JSON.stringify({
        branch: config.ref,
        content: Buffer.from(content, "utf8").toString("base64"),
        message: `add research idea: ${title.slice(0, 72) || "untitled"}`
      }),
      cache: "no-store"
    }
  );

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body: {
        error: "GitHub research idea commit failed",
        ...(await readResponseBody(response))
      }
    };
  }

  const body = await readResponseBody(response);
  return {
    ok: true,
    status: response.status,
    body: {
      path: normalizedPath,
      ref: config.ref,
      ...body
    }
  };
}
