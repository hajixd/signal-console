import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { commitResearchIdeaFile } from "@/lib/research-workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESEARCH_ROOT = path.join(process.cwd(), "Research");
const IDEA_STATUSES = ["inbox", "approved"] as const;
const SUPPORTED_TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "overnight"]);

type IdeaStatus = (typeof IDEA_STATUSES)[number];

type ResearchIdea = {
  assetKeys?: string[];
  createdAt?: string;
  hypothesis?: string;
  ideaId?: string;
  markets?: string[];
  notes?: string;
  provenance?: string;
  sourceUrls?: string[];
  status?: string;
  timeframes?: string[];
  title?: string;
  updatedAt?: string;
};

type ResearchIdeaUpdatePayload = {
  assetKeys?: unknown;
  hypothesis?: unknown;
  timeframes?: unknown;
  title?: unknown;
};

type RouteContext = {
  params: Promise<{ ideaId: string }> | { ideaId: string };
};

function cleanString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function splitList(value: unknown, maxItems = 12) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item, 140)).filter(Boolean).slice(0, maxItems);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function ideaDirectory(status: IdeaStatus) {
  return path.join(RESEARCH_ROOT, "ideas", status);
}

function isIdeaFile(name: string) {
  return !name.startsWith(".") && !name.startsWith("_") && name.endsWith(".json");
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function findIdea(ideaId: string): Promise<{ filePath: string; idea: ResearchIdea; relativePath: string; status: IdeaStatus } | null> {
  const requestedId = decodeURIComponent(ideaId).trim();
  if (!requestedId) return null;

  for (const status of IDEA_STATUSES) {
    const directory = ideaDirectory(status);
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !isIdeaFile(entry.name)) continue;
      const filePath = path.join(directory, entry.name);
      const idea = await readJsonFile<ResearchIdea>(filePath);
      if (!idea) continue;
      const fileId = path.basename(entry.name, ".json");
      if (idea.ideaId !== requestedId && fileId !== requestedId) continue;
      const relativePath = path.posix.join("Research", "ideas", status, entry.name);
      return { filePath, idea, relativePath, status };
    }
  }

  return null;
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { ideaId } = await Promise.resolve(context.params);
  const match = await findIdea(ideaId);
  if (!match) {
    return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  }

  let payload: ResearchIdeaUpdatePayload;
  try {
    payload = (await request.json()) as ResearchIdeaUpdatePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const title = cleanString(payload.title, 120);
  const hypothesis = cleanString(payload.hypothesis, 1200);
  const timeframes = splitList(payload.timeframes).filter((timeframe) => SUPPORTED_TIMEFRAMES.has(timeframe));
  const assetKeys = splitList(payload.assetKeys, 32);

  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  if (!hypothesis) {
    return NextResponse.json({ error: "Hypothesis is required." }, { status: 400 });
  }

  const idea: ResearchIdea = {
    ...match.idea,
    assetKeys,
    hypothesis,
    status: match.status,
    timeframes: timeframes.length ? timeframes : ["15m"],
    title,
    updatedAt: new Date().toISOString()
  };
  const content = `${JSON.stringify(idea, null, 2)}\n`;
  const useGithubStorage = process.env.RESEARCH_IDEA_WRITE_MODE === "github" || process.env.NODE_ENV === "production";

  if (useGithubStorage) {
    const result = await commitResearchIdeaFile(match.relativePath, content, title);
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }
    return NextResponse.json({
      commit: result.body,
      idea,
      ok: true,
      path: match.relativePath,
      storage: "github"
    });
  }

  await fs.writeFile(match.filePath, content, "utf8");
  return NextResponse.json({
    idea,
    ok: true,
    path: path.relative(process.cwd(), match.filePath)
  });
}
