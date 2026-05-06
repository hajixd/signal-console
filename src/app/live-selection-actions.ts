"use server";

import { getLiveConfig, saveLiveConfig } from "@/lib/live-config";
import { STRATEGY_DEFINITIONS } from "@/lib/strategy-loader";

const VALID_STRATEGY_IDS = new Set(STRATEGY_DEFINITIONS.map((strategy) => strategy.id));

type PersistedStrategyEdit = {
  contracts?: number;
  riskDollars?: number;
  slUnits?: number;
  targetDollars?: number;
  tpUnits?: number;
};

function normalizeSelectedKeys(selectedKeys: string[]): string[] {
  return [...new Set(selectedKeys.map((key) => key.trim()).filter((key) => VALID_STRATEGY_IDS.has(key)))];
}

function sameSelection(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function normalizePositiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100) / 100 : undefined;
}

function normalizeStrategyEdits(edits: Record<string, PersistedStrategyEdit>): Record<string, PersistedStrategyEdit> {
  const normalizedEntries = Object.entries(edits)
    .map(([key, edit]) => {
      const strategyKey = key.trim();
      if (!VALID_STRATEGY_IDS.has(strategyKey) || !edit || typeof edit !== "object") return null;

      const normalized: PersistedStrategyEdit = {};
      const contracts = normalizePositiveNumber(edit.contracts);
      const tpUnits = normalizePositiveNumber(edit.tpUnits);
      const slUnits = normalizePositiveNumber(edit.slUnits);
      const targetDollars = normalizePositiveNumber(edit.targetDollars);
      const riskDollars = normalizePositiveNumber(edit.riskDollars);

      if (contracts !== undefined) normalized.contracts = contracts;
      if (tpUnits !== undefined) normalized.tpUnits = tpUnits;
      if (slUnits !== undefined) normalized.slUnits = slUnits;
      if (targetDollars !== undefined) normalized.targetDollars = targetDollars;
      if (riskDollars !== undefined) normalized.riskDollars = riskDollars;
      if (!Object.keys(normalized).length) return null;

      return [strategyKey, normalized] as const;
    })
    .filter((entry): entry is readonly [string, PersistedStrategyEdit] => Boolean(entry));

  return Object.fromEntries(normalizedEntries);
}

function strategyEditSignature(edits: Record<string, PersistedStrategyEdit>): string {
  return JSON.stringify(
    Object.keys(edits)
      .sort()
      .map((key) => [key, edits[key]])
  );
}

export async function syncLiveSelection(selectedKeys: string[], scopeKeys?: string[]): Promise<void> {
  const normalized = normalizeSelectedKeys(selectedKeys);
  const normalizedScope = scopeKeys ? new Set(normalizeSelectedKeys(scopeKeys)) : null;
  const existing = await getLiveConfig();
  const nextEnabledDatasetIds = normalizedScope
    ? [...existing.enabledDatasetIds.filter((key) => !normalizedScope.has(key)), ...normalized]
    : normalized;
  const nextDashboardSelectedDatasetIds = normalizedScope
    ? [...existing.dashboardSelectedDatasetIds.filter((key) => !normalizedScope.has(key)), ...normalized]
    : normalized;

  if (
    sameSelection(existing.enabledDatasetIds, nextEnabledDatasetIds) &&
    sameSelection(existing.dashboardSelectedDatasetIds, nextDashboardSelectedDatasetIds)
  ) {
    return;
  }

  await saveLiveConfig({
    enabledDatasetIds: nextEnabledDatasetIds,
    dashboardSelectedDatasetIds: nextDashboardSelectedDatasetIds,
    strategyEdits: existing.strategyEdits
  });
}

export async function syncStrategyEdits(edits: Record<string, PersistedStrategyEdit>): Promise<void> {
  const normalized = normalizeStrategyEdits(edits);
  const existing = await getLiveConfig();

  if (strategyEditSignature(existing.strategyEdits) === strategyEditSignature(normalized)) {
    return;
  }

  await saveLiveConfig({
    enabledDatasetIds: existing.enabledDatasetIds,
    dashboardSelectedDatasetIds: existing.dashboardSelectedDatasetIds,
    strategyEdits: normalized
  });
}
