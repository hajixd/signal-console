"use server";

import { getLiveConfig, saveLiveConfig } from "@/lib/live-config";
import { STRATEGY_DEFINITIONS } from "@/lib/strategy-loader";

const VALID_STRATEGY_IDS = new Set(STRATEGY_DEFINITIONS.map((strategy) => strategy.id));

function normalizeSelectedKeys(selectedKeys: string[]): string[] {
  return [...new Set(selectedKeys.map((key) => key.trim()).filter((key) => VALID_STRATEGY_IDS.has(key)))];
}

function sameSelection(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export async function syncLiveSelection(selectedKeys: string[]): Promise<void> {
  const normalized = normalizeSelectedKeys(selectedKeys);
  const existing = await getLiveConfig();

  if (
    sameSelection(existing.enabledDatasetIds, normalized) &&
    sameSelection(existing.dashboardSelectedDatasetIds, normalized)
  ) {
    return;
  }

  await saveLiveConfig({
    enabledDatasetIds: normalized,
    dashboardSelectedDatasetIds: normalized,
    strategyEdits: existing.strategyEdits
  });
}
