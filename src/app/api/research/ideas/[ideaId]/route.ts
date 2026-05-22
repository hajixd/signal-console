import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-api";
import { commitResearchIdeaFile } from "@/lib/research-workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESEARCH_ROOT = path.join(process.cwd(), "Research");
const IDEA_STATUSES = ["inbox", "approved"] as const;
const SUPPORTED_TIMEFRAMES = new Set(["1m", "5m", "10m", "15m", "30m", "45m", "1h", "4h", "1d", "overnight"]);
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

type IdeaStatus = (typeof IDEA_STATUSES)[number];

type ResearchIdea = {
  assetKeys?: string[];
  createdAt?: string;
  hypothesis?: string;
  ideaReport?: ResearchIdeaReport;
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

type ResearchIdeaReport = {
  assetSelection?: string;
  entry?: string;
  entryConditions?: string;
  exit?: string;
  exitConditions?: string;
  extraNotes?: string;
  filters?: string[];
  implementationNotes?: string[];
  invalidations?: string[];
  limitOrderPlan?: string;
  overallDescription?: string;
  parameterNotes?: string[];
  setup?: string;
  sourceInterpretation?: string;
  stop?: string;
  stopLossPlan?: string;
  summary?: string;
  takeProfitPlan?: string;
  target?: string;
  timeframes?: string[];
  useLimitOrder?: string;
};

type ResearchIdeaUpdatePayload = {
  assetKeys?: unknown;
  hypothesis?: unknown;
  ideaReport?: unknown;
  notes?: unknown;
  sourceUrls?: unknown;
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

function cleanUrls(value: unknown, fallbackText = "") {
  const direct = splitList(value, 16);
  const fromText = [...fallbackText.matchAll(URL_PATTERN)].map((match) => match[0]);
  return [...new Set([...direct, ...fromText].map((url) => url.replace(/[.,;:!?]+$/, "")))].slice(0, 16);
}

function cleanList(value: unknown, maxItems = 16) {
  return splitList(value, maxItems).map((item) => item.slice(0, 320));
}

function cleanReportText(source: Record<string, unknown>, existing: ResearchIdeaReport | undefined, key: keyof ResearchIdeaReport, maxLength: number) {
  if (!(key in source)) {
    const existingValue = existing?.[key];
    return typeof existingValue === "string" ? existingValue : undefined;
  }
  return cleanString(source[key], maxLength) || undefined;
}

function cleanIdeaReport(value: unknown, existing: ResearchIdeaReport | undefined, timeframes: string[]): ResearchIdeaReport | undefined {
  if (!value || typeof value !== "object") return existing;
  const source = value as Record<string, unknown>;
  const report: ResearchIdeaReport = {
    ...(existing ?? {}),
    assetSelection: cleanReportText(source, existing, "assetSelection", 1800),
    entry: cleanReportText(source, existing, "entry", 2200),
    entryConditions: cleanReportText(source, existing, "entryConditions", 2200),
    exit: cleanReportText(source, existing, "exit", 2200),
    exitConditions: cleanReportText(source, existing, "exitConditions", 2200),
    extraNotes: cleanReportText(source, existing, "extraNotes", 2200),
    filters: "filters" in source ? cleanList(source.filters, 16) : existing?.filters,
    implementationNotes: "implementationNotes" in source ? cleanList(source.implementationNotes, 16) : existing?.implementationNotes,
    invalidations: "invalidations" in source ? cleanList(source.invalidations, 16) : existing?.invalidations,
    limitOrderPlan: cleanReportText(source, existing, "limitOrderPlan", 1800),
    overallDescription: cleanReportText(source, existing, "overallDescription", 2400),
    parameterNotes: "parameterNotes" in source ? cleanList(source.parameterNotes, 16) : existing?.parameterNotes,
    setup: cleanReportText(source, existing, "setup", 2200),
    sourceInterpretation: cleanReportText(source, existing, "sourceInterpretation", 2200),
    stop: cleanReportText(source, existing, "stop", 1800),
    stopLossPlan: cleanReportText(source, existing, "stopLossPlan", 1800),
    summary: cleanReportText(source, existing, "summary", 2400),
    takeProfitPlan: cleanReportText(source, existing, "takeProfitPlan", 1800),
    target: cleanReportText(source, existing, "target", 1800),
    timeframes,
    useLimitOrder: cleanReportText(source, existing, "useLimitOrder", 320)
  };

  return Object.fromEntries(
    Object.entries(report).filter(([, item]) => (Array.isArray(item) ? item.length > 0 : item !== undefined && item !== ""))
  ) as ResearchIdeaReport;
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
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

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
  const hypothesis = cleanString(payload.hypothesis, 2200);
  const timeframes = splitList(payload.timeframes).filter((timeframe) => SUPPORTED_TIMEFRAMES.has(timeframe));
  const assetKeys = splitList(payload.assetKeys, 32);
  const sourceUrls = cleanUrls(payload.sourceUrls, `${title}\n${hypothesis}`);
  const notes = cleanString(payload.notes, 2200);
  const normalizedTimeframes = timeframes.length ? timeframes : ["15m"];
  const ideaReport = cleanIdeaReport(
    payload.ideaReport,
    match.idea.ideaReport,
    normalizedTimeframes
  );

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
    ideaReport,
    notes,
    sourceUrls,
    status: match.status,
    timeframes: normalizedTimeframes,
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
