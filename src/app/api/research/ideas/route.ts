import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { commitResearchIdeaFile } from "@/lib/research-workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESEARCH_ROOT = path.join(process.cwd(), "Research");
const SUPPORTED_ENGINES = new Set(["overnight_bias", "open_gap", "intraday_momentum", "range_break", "daily_tsmom"]);
const SUPPORTED_MARKETS = new Set(["futures", "forex"]);
const SUPPORTED_TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "overnight"]);

type ResearchIdeaPayload = {
  assetKeys?: unknown;
  engine?: unknown;
  hypothesis?: unknown;
  markets?: unknown;
  notes?: unknown;
  provenance?: unknown;
  sourceUrls?: unknown;
  status?: unknown;
  timeframes?: unknown;
  title?: unknown;
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

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 82) || "research_idea";
}

function uniqueRuntimeIdeaId(baseId: string) {
  return `${baseId}_${Date.now().toString(36)}`;
}

function defaultParameterGrid(engine: string) {
  if (engine === "overnight_bias") {
    return {
      entryMinute: [945],
      exitMinute: [570],
      side: ["long", "short"]
    };
  }
  if (engine === "open_gap") {
    return {
      direction: ["fade", "continue"],
      entryMinute: [570],
      exitMinute: [945],
      minGapAtr: [0, 0.1, 0.2, 0.35]
    };
  }
  if (engine === "intraday_momentum") {
    return {
      direction: ["same", "opposite"],
      entryMinute: [570, 780],
      exitMinute: [780, 945],
      minSignalAtr: [0, 0.1, 0.25],
      signalEndMinute: [600],
      signalStartMinute: [570]
    };
  }
  if (engine === "range_break") {
    return {
      breakEndMinute: [660, 720],
      breakStartMinute: [570, 600],
      direction: ["breakout", "fade"],
      forcedExitMinute: [945],
      rangeEndMinute: [570],
      rangeStartMinute: [480],
      riskReward: [1, 1.5, 2]
    };
  }
  return {
    direction: ["momentum", "reversal"],
    entryMinute: [570],
    exitMinute: [945],
    lookbackDays: [3, 5, 10]
  };
}

function inferEngine(timeframes: string[]) {
  if (timeframes.includes("overnight")) return "overnight_bias";
  if (timeframes.includes("1d")) return "daily_tsmom";
  return "intraday_momentum";
}

async function uniqueIdeaPath(directory: string, baseId: string) {
  let candidate = path.join(directory, `${baseId}.json`);
  let suffix = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(directory, `${baseId}_${suffix}.json`);
      suffix += 1;
    } catch {
      return candidate;
    }
  }
}

export async function POST(request: NextRequest) {
  let payload: ResearchIdeaPayload;
  try {
    payload = (await request.json()) as ResearchIdeaPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const title = cleanString(payload.title, 120);
  const hypothesis = cleanString(payload.hypothesis, 1200);
  const requestedTimeframes = splitList(payload.timeframes).filter((timeframe) => SUPPORTED_TIMEFRAMES.has(timeframe));
  const timeframes = requestedTimeframes.length ? requestedTimeframes : ["15m"];
  const fallbackEngine = inferEngine(timeframes);
  const requestedEngine = cleanString(payload.engine, 80);
  const engine = SUPPORTED_ENGINES.has(requestedEngine) ? requestedEngine : fallbackEngine;
  const status = "inbox";
  const requestedMarkets = splitList(payload.markets).filter((market) => SUPPORTED_MARKETS.has(market));
  const markets = requestedMarkets.length ? requestedMarkets : ["futures", "forex"];
  const assetKeys = splitList(payload.assetKeys);
  const sourceUrls: string[] = [];
  const provenance = "manual";
  const notes = cleanString(payload.notes, 1200);

  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  if (!hypothesis) {
    return NextResponse.json({ error: "Hypothesis is required." }, { status: 400 });
  }

  const ideaId = slug(title);
  const directory = path.join(RESEARCH_ROOT, "ideas", status);
  const useGithubStorage = process.env.RESEARCH_IDEA_WRITE_MODE === "github" || process.env.NODE_ENV === "production";
  const filePath = useGithubStorage ? "" : await uniqueIdeaPath(directory, ideaId);
  const finalIdeaId = useGithubStorage ? uniqueRuntimeIdeaId(ideaId) : path.basename(filePath, ".json");
  const createdAt = new Date().toISOString();
  const idea = {
    assetKeys,
    createdAt,
    engine,
    engines: [engine],
    hypothesis,
    ideaId: finalIdeaId,
    markets,
    notes,
    parameterGrid: undefined,
    provenance,
    sourceUrls,
    status,
    timeframes,
    title
  };

  const content = `${JSON.stringify(idea, null, 2)}\n`;

  if (useGithubStorage) {
    const relativePath = path.posix.join("Research", "ideas", status, `${finalIdeaId}.json`);
    const result = await commitResearchIdeaFile(relativePath, content, title);
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }
    return NextResponse.json({
      commit: result.body.commit,
      idea,
      ok: true,
      path: relativePath,
      storage: "github"
    });
  }

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath, content, "utf8");

  return NextResponse.json({
    idea,
    ok: true,
    path: path.relative(process.cwd(), filePath)
  });
}
