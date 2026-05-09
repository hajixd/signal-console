import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-api";
import { getDatasetStatus, getLiveConfig, saveLiveConfig, type LiveConfig } from "@/lib/live-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function parseLiveConfig(value: unknown): LiveConfig {
  const payload = value && typeof value === "object" ? (value as Partial<LiveConfig>) : {};
  const strategyEdits =
    payload.strategyEdits && typeof payload.strategyEdits === "object"
      ? (payload.strategyEdits as LiveConfig["strategyEdits"])
      : {};
  const customScaleRanges =
    payload.customScaleRanges && typeof payload.customScaleRanges === "object"
      ? (payload.customScaleRanges as LiveConfig["customScaleRanges"])
      : {};
  const dashboardSettings =
    payload.dashboardSettings && typeof payload.dashboardSettings === "object"
      ? (payload.dashboardSettings as LiveConfig["dashboardSettings"])
      : {};

  return {
    customScaleRanges,
    dashboardSettings,
    dashboardSelectedDatasetIds: parseStringArray(payload.dashboardSelectedDatasetIds),
    enabledDatasetIds: parseStringArray(payload.enabledDatasetIds),
    strategyEdits
  };
}

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [config, datasetStatus] = await Promise.all([getLiveConfig(), getDatasetStatus()]);
  return NextResponse.json({ config, datasetStatus });
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = parseLiveConfig(await request.json());
  const saved = await saveLiveConfig(payload);
  return NextResponse.json({ ok: true, config: saved });
}
