"use server";

import { getLiveConfig, saveLiveConfig } from "@/lib/live-config";
import { assertServerActionAdminAuthorized } from "@/lib/admin-api";
import type { ChallengeRulesMarket, LiveMarket, SavedChallengeRules, SavedCustomScaleRange, SavedTheme } from "@/lib/live-config";
import { STRATEGY_DEFINITIONS } from "@/lib/strategy-loader";

const VALID_STRATEGY_IDS = new Set(STRATEGY_DEFINITIONS.map((strategy) => strategy.id));

type PersistedStrategyEdit = {
  contracts?: number;
  riskDollars?: number;
  scale?: number;
  slUnits?: number;
  targetDollars?: number;
  tpUnits?: number;
};

type PersistedCustomScaleRange = Partial<Record<keyof SavedCustomScaleRange, unknown>>;
type PersistedChallengeRules = Partial<Record<keyof SavedChallengeRules, unknown>>;

function normalizeSelectedKeys(selectedKeys: string[]): string[] {
  return [...new Set(selectedKeys.map((key) => key.trim()).filter((key) => VALID_STRATEGY_IDS.has(key)))];
}

function normalizeStrategyScopeKeys(scopeKeys: string[] | undefined): Set<string> | null {
  if (!scopeKeys) return null;
  const normalized = normalizeSelectedKeys(scopeKeys);
  return normalized.length ? new Set(normalized) : null;
}

function sameSelection(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function normalizePositiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100) / 100 : undefined;
}

function normalizeMarket(value: string): LiveMarket | null {
  return value === "forex" || value === "futures" || value === "gold_spot" ? value : null;
}

function normalizeChallengeMarket(value: string): ChallengeRulesMarket | null {
  if (value === "gold_spot") return "forex";
  return value === "forex" || value === "futures" ? value : null;
}

function normalizeTheme(value: string): SavedTheme | null {
  return value === "dark" || value === "light" ? value : null;
}

function normalizeRangeValue(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  if (!text) return undefined;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? text : undefined;
}

function normalizeCustomScaleRange(range: PersistedCustomScaleRange): SavedCustomScaleRange {
  const normalized: SavedCustomScaleRange = {};
  const targetFloor = normalizeRangeValue(range.targetFloor);
  const targetCeiling = normalizeRangeValue(range.targetCeiling);
  const riskFloor = normalizeRangeValue(range.riskFloor);
  const riskCeiling = normalizeRangeValue(range.riskCeiling);

  if (targetFloor !== undefined) normalized.targetFloor = targetFloor;
  if (targetCeiling !== undefined) normalized.targetCeiling = targetCeiling;
  if (riskFloor !== undefined) normalized.riskFloor = riskFloor;
  if (riskCeiling !== undefined) normalized.riskCeiling = riskCeiling;

  return normalized;
}

function normalizePositiveSetting(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100) / 100 : undefined;
}

function normalizeNonNegativeSetting(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) / 100 : undefined;
}

function normalizeChallengeRules(rules: PersistedChallengeRules): SavedChallengeRules {
  const normalized: SavedChallengeRules = {};
  const startingBalance = normalizePositiveSetting(rules.startingBalance);
  const profitTarget = normalizePositiveSetting(rules.profitTarget);
  const maximumLossLimit = normalizeNonNegativeSetting(rules.maximumLossLimit);
  const dailyLossLimit = normalizeNonNegativeSetting(rules.dailyLossLimit);
  const dailyProfitLock = normalizeNonNegativeSetting(rules.dailyProfitLock);
  const dailyLossStop = normalizeNonNegativeSetting(rules.dailyLossStop);

  if (startingBalance !== undefined) normalized.startingBalance = startingBalance;
  if (profitTarget !== undefined) normalized.profitTarget = profitTarget;
  if (maximumLossLimit !== undefined) normalized.maximumLossLimit = maximumLossLimit;
  if (dailyLossLimit !== undefined) normalized.dailyLossLimit = dailyLossLimit;
  if (dailyProfitLock !== undefined) normalized.dailyProfitLock = dailyProfitLock;
  if (dailyLossStop !== undefined) normalized.dailyLossStop = dailyLossStop;

  return normalized;
}

function normalizeStrategyEdits(edits: Record<string, PersistedStrategyEdit>): Record<string, PersistedStrategyEdit> {
  const normalizedEntries = Object.entries(edits)
    .map(([key, edit]) => {
      const strategyKey = key.trim();
      if (!VALID_STRATEGY_IDS.has(strategyKey) || !edit || typeof edit !== "object") return null;

      const normalized: PersistedStrategyEdit = {};
      const contracts = normalizePositiveNumber(edit.contracts);
      const scale = normalizePositiveNumber(edit.scale);
      const tpUnits = normalizePositiveNumber(edit.tpUnits);
      const slUnits = normalizePositiveNumber(edit.slUnits);
      const targetDollars = normalizePositiveNumber(edit.targetDollars);
      const riskDollars = normalizePositiveNumber(edit.riskDollars);

      if (contracts !== undefined) normalized.contracts = contracts;
      if (scale !== undefined) normalized.scale = scale;
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

function customScaleRangeSignature(range: SavedCustomScaleRange | undefined): string {
  const source = range ?? {};
  return JSON.stringify(
    Object.keys(source)
      .sort()
      .map((key) => [key, source[key as keyof SavedCustomScaleRange]])
  );
}

function challengeRulesSignature(rules: SavedChallengeRules | undefined): string {
  const source = rules ?? {};
  return JSON.stringify(
    Object.keys(source)
      .sort()
      .map((key) => [key, source[key as keyof SavedChallengeRules]])
  );
}

export async function syncLiveSelection(selectedKeys: string[], scopeKeys?: string[]): Promise<void> {
  await assertServerActionAdminAuthorized();
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
    ...existing,
    enabledDatasetIds: nextEnabledDatasetIds,
    dashboardSelectedDatasetIds: nextDashboardSelectedDatasetIds
  });
}

export async function syncStrategyEdits(edits: Record<string, PersistedStrategyEdit>, scopeKeys?: string[]): Promise<void> {
  await assertServerActionAdminAuthorized();
  const normalized = normalizeStrategyEdits(edits);
  const normalizedScope = normalizeStrategyScopeKeys(scopeKeys);
  const existing = await getLiveConfig();
  const nextStrategyEdits = normalizedScope
    ? {
        ...Object.fromEntries(Object.entries(existing.strategyEdits).filter(([key]) => !normalizedScope.has(key))),
        ...normalized
      }
    : normalized;

  if (strategyEditSignature(existing.strategyEdits) === strategyEditSignature(nextStrategyEdits)) {
    return;
  }

  await saveLiveConfig({
    ...existing,
    strategyEdits: nextStrategyEdits
  });
}

export async function syncCustomScaleRange(market: string, range: PersistedCustomScaleRange): Promise<void> {
  await assertServerActionAdminAuthorized();
  const normalizedMarket = normalizeMarket(market);
  if (!normalizedMarket) return;

  const normalizedRange = normalizeCustomScaleRange(range);
  const existing = await getLiveConfig();

  if (customScaleRangeSignature(existing.customScaleRanges[normalizedMarket]) === customScaleRangeSignature(normalizedRange)) {
    return;
  }

  const nextCustomScaleRanges = { ...existing.customScaleRanges };
  if (Object.keys(normalizedRange).length) {
    nextCustomScaleRanges[normalizedMarket] = normalizedRange;
  } else {
    delete nextCustomScaleRanges[normalizedMarket];
  }

  await saveLiveConfig({
    ...existing,
    customScaleRanges: nextCustomScaleRanges
  });
}

export async function syncActiveMarket(market: string): Promise<void> {
  const normalizedMarket = normalizeChallengeMarket(market);
  if (!normalizedMarket) return;

  const existing = await getLiveConfig();
  if (existing.dashboardSettings.activeMarket === normalizedMarket) {
    return;
  }

  await saveLiveConfig({
    ...existing,
    dashboardSettings: {
      ...existing.dashboardSettings,
      activeMarket: normalizedMarket
    }
  });
}

export async function syncChallengeRules(rules: PersistedChallengeRules): Promise<void> {
  await assertServerActionAdminAuthorized();
  const normalized = normalizeChallengeRules(rules);
  if (!Object.keys(normalized).length) return;

  const existing = await getLiveConfig();
  if (challengeRulesSignature(existing.dashboardSettings.challengeRules) === challengeRulesSignature(normalized)) {
    return;
  }

  await saveLiveConfig({
    ...existing,
    dashboardSettings: {
      ...existing.dashboardSettings,
      challengeRules: normalized
    }
  });
}

export async function syncChallengeRulesForMarket(market: string, rules: PersistedChallengeRules): Promise<void> {
  await assertServerActionAdminAuthorized();
  const normalizedMarket = normalizeChallengeMarket(market);
  if (!normalizedMarket) return;

  const normalized = normalizeChallengeRules(rules);
  if (!Object.keys(normalized).length) return;

  const existing = await getLiveConfig();
  if (challengeRulesSignature(existing.dashboardSettings.challengeRulesByMarket?.[normalizedMarket]) === challengeRulesSignature(normalized)) {
    return;
  }

  await saveLiveConfig({
    ...existing,
    dashboardSettings: {
      ...existing.dashboardSettings,
      challengeRulesByMarket: {
        ...(existing.dashboardSettings.challengeRulesByMarket ?? {}),
        [normalizedMarket]: normalized
      }
    }
  });
}

export async function syncTheme(theme: string): Promise<void> {
  const normalizedTheme = normalizeTheme(theme);
  if (!normalizedTheme) return;

  const existing = await getLiveConfig();
  if (existing.dashboardSettings.theme === normalizedTheme) {
    return;
  }

  await saveLiveConfig({
    ...existing,
    dashboardSettings: {
      ...existing.dashboardSettings,
      theme: normalizedTheme
    }
  });
}
