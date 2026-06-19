"use server";

import { DASHBOARD_MARKETS, getLiveConfig, saveLiveConfig, withSavedStrategySelection } from "@/lib/live-config";
import { assertServerActionAdminAuthorized } from "@/lib/admin-api";
import { getCachedChallengeReplay, saveCachedChallengeReplay } from "@/lib/challenge-replay-cache";
import type { ChallengeReplaySummary } from "@/lib/challenge";
import type { ChallengeRulesMarket, DashboardMarket, LiveConfig, LiveMarket, SavedChallengeRules, SavedCustomScaleRange, SavedDatasetIdsByMarket, SavedTheme } from "@/lib/live-config";
import { assetForKey } from "@/lib/assets";
import { STRATEGY_DEFINITIONS } from "@/lib/strategy-loader";

const VALID_STRATEGY_IDS = new Set(STRATEGY_DEFINITIONS.map((strategy) => strategy.id));
const STRATEGY_MARKET_BY_ID = new Map(
  STRATEGY_DEFINITIONS.map((strategy) => {
    const market = assetForKey(strategy.assetKey).market === "futures" ? "futures" : "forex";
    return [strategy.id, market] as const;
  })
);

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

function normalizeDashboardMarket(value: string | undefined): DashboardMarket | null {
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

function strategyMarket(key: string): DashboardMarket | undefined {
  return STRATEGY_MARKET_BY_ID.get(key);
}

function normalizeDatasetIdsByMarket(source: SavedDatasetIdsByMarket | undefined, legacyKeys: string[]): SavedDatasetIdsByMarket {
  const byMarket: SavedDatasetIdsByMarket = {};

  for (const market of DASHBOARD_MARKETS) {
    const marketKeys = normalizeSelectedKeys(source?.[market] ?? []);
    const seededKeys = marketKeys.length
      ? marketKeys
      : normalizeSelectedKeys(legacyKeys).filter((key) => strategyMarket(key) === market);
    if (seededKeys.length) byMarket[market] = seededKeys;
  }

  return byMarket;
}

function flattenDatasetIdsByMarket(byMarket: SavedDatasetIdsByMarket): string[] {
  return [...new Set(DASHBOARD_MARKETS.flatMap((market) => byMarket[market] ?? []))];
}

function selectionByMarketSignature(byMarket: SavedDatasetIdsByMarket | undefined): string {
  const source = byMarket ?? {};
  return JSON.stringify(DASHBOARD_MARKETS.map((market) => [market, source[market] ?? []]));
}

function liveSelectionUnchanged(
  existing: Pick<LiveConfig, "dashboardSelectedDatasetIds" | "dashboardSelectedDatasetIdsByMarket" | "enabledDatasetIds" | "enabledDatasetIdsByMarket">,
  next: Pick<LiveConfig, "dashboardSelectedDatasetIds" | "dashboardSelectedDatasetIdsByMarket" | "enabledDatasetIds" | "enabledDatasetIdsByMarket">
): boolean {
  return (
    sameSelection(existing.enabledDatasetIds, next.enabledDatasetIds) &&
    sameSelection(existing.dashboardSelectedDatasetIds, next.dashboardSelectedDatasetIds) &&
    selectionByMarketSignature(existing.enabledDatasetIdsByMarket) === selectionByMarketSignature(next.enabledDatasetIdsByMarket) &&
    selectionByMarketSignature(existing.dashboardSelectedDatasetIdsByMarket) === selectionByMarketSignature(next.dashboardSelectedDatasetIdsByMarket)
  );
}

export async function syncLiveSelection(selectedKeys: string[], scopeKeys?: string[], market?: string): Promise<void> {
  await assertServerActionAdminAuthorized();
  const normalized = normalizeSelectedKeys(selectedKeys);
  const normalizedMarket = normalizeDashboardMarket(market);
  const existing = await getLiveConfig();

  if (normalizedMarket) {
    const nextConfig = withSavedStrategySelection(existing, normalized, { market: normalizedMarket });

    if (liveSelectionUnchanged(existing, nextConfig)) return;
    await saveLiveConfig(nextConfig);
    return;
  }

  const normalizedScope = scopeKeys ? new Set(normalizeSelectedKeys(scopeKeys)) : null;
  const nextEnabledDatasetIds = normalizedScope
    ? [...existing.enabledDatasetIds.filter((key) => !normalizedScope.has(key)), ...normalized]
    : normalized;
  const nextDashboardSelectedDatasetIds = normalizedScope
    ? [...existing.dashboardSelectedDatasetIds.filter((key) => !normalizedScope.has(key)), ...normalized]
    : normalized;
  const nextEnabledDatasetIdsByMarket = normalizeDatasetIdsByMarket({}, nextEnabledDatasetIds);
  const nextDashboardSelectedDatasetIdsByMarket = normalizeDatasetIdsByMarket({}, nextDashboardSelectedDatasetIds);
  const nextConfig = {
    ...existing,
    enabledStrategyIds: nextEnabledDatasetIds,
    enabledStrategyIdsByMarket: nextEnabledDatasetIdsByMarket,
    enabledDatasetIds: nextEnabledDatasetIds,
    enabledDatasetIdsByMarket: nextEnabledDatasetIdsByMarket,
    dashboardSelectedStrategyIds: nextDashboardSelectedDatasetIds,
    dashboardSelectedStrategyIdsByMarket: nextDashboardSelectedDatasetIdsByMarket,
    dashboardSelectedDatasetIds: nextDashboardSelectedDatasetIds,
    dashboardSelectedDatasetIdsByMarket: nextDashboardSelectedDatasetIdsByMarket
  };

  if (liveSelectionUnchanged(existing, nextConfig)) return;

  await saveLiveConfig({
    ...nextConfig
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
  await assertServerActionAdminAuthorized();
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

export async function loadChallengeReplayCache(cacheKey: string): Promise<ChallengeReplaySummary | null> {
  return getCachedChallengeReplay(cacheKey);
}

export async function syncChallengeReplayCache(cacheKey: string, summary: ChallengeReplaySummary): Promise<void> {
  await assertServerActionAdminAuthorized();
  await saveCachedChallengeReplay(cacheKey, summary);
}

export async function syncTheme(theme: string): Promise<void> {
  await assertServerActionAdminAuthorized();
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
