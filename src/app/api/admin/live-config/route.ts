import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-api";
import { firebaseAdminRuntimeDiagnostics } from "@/lib/firebase-admin";
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
    dashboardSelectedStrategyIdsByMarket:
      payload.dashboardSelectedStrategyIdsByMarket && typeof payload.dashboardSelectedStrategyIdsByMarket === "object"
        ? (payload.dashboardSelectedStrategyIdsByMarket as LiveConfig["dashboardSelectedStrategyIdsByMarket"])
        : payload.dashboardSelectedDatasetIdsByMarket && typeof payload.dashboardSelectedDatasetIdsByMarket === "object"
          ? (payload.dashboardSelectedDatasetIdsByMarket as LiveConfig["dashboardSelectedStrategyIdsByMarket"])
          : {},
    dashboardSelectedStrategyIds: parseStringArray(payload.dashboardSelectedStrategyIds ?? payload.dashboardSelectedDatasetIds),
    enabledStrategyIdsByMarket:
      payload.enabledStrategyIdsByMarket && typeof payload.enabledStrategyIdsByMarket === "object"
        ? (payload.enabledStrategyIdsByMarket as LiveConfig["enabledStrategyIdsByMarket"])
        : payload.enabledDatasetIdsByMarket && typeof payload.enabledDatasetIdsByMarket === "object"
          ? (payload.enabledDatasetIdsByMarket as LiveConfig["enabledStrategyIdsByMarket"])
          : {},
    enabledStrategyIds: parseStringArray(payload.enabledStrategyIds ?? payload.enabledDatasetIds),
    dashboardSelectedDatasetIdsByMarket:
      payload.dashboardSelectedDatasetIdsByMarket && typeof payload.dashboardSelectedDatasetIdsByMarket === "object"
        ? (payload.dashboardSelectedDatasetIdsByMarket as LiveConfig["dashboardSelectedDatasetIdsByMarket"])
        : {},
    dashboardSelectedDatasetIds: parseStringArray(payload.dashboardSelectedDatasetIds),
    enabledDatasetIdsByMarket:
      payload.enabledDatasetIdsByMarket && typeof payload.enabledDatasetIdsByMarket === "object"
        ? (payload.enabledDatasetIdsByMarket as LiveConfig["enabledDatasetIdsByMarket"])
        : {},
    enabledDatasetIds: parseStringArray(payload.enabledDatasetIds),
    strategyEdits
  };
}

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [config, datasetStatus] = await Promise.all([getLiveConfig(), getDatasetStatus()]);
  return NextResponse.json({ config, datasetStatus, runtime: { firebaseAdmin: firebaseAdminRuntimeDiagnostics() } });
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = parseLiveConfig(await request.json());
  const saved = await saveLiveConfig(payload);
  return NextResponse.json({ ok: true, config: saved });
}
