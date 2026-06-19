import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseDb, firebaseLocalFallbackEnabled, hasFirebaseAdmin, storageObjectPath, withFirebaseTimeout } from "@/lib/firebase-admin";
import { omitUndefinedDeep } from "@/lib/firestore-utils";
import { r2Configured, r2ObjectKey } from "@/lib/r2";
import { getTursoDocument, saveTursoDocument, tursoConfigured } from "@/lib/turso";
import type { CronResult } from "@/lib/types";

const LIVE_CONFIG_CACHE_TTL_MS = 30_000;
const DATASET_STATUS_CACHE_TTL_MS = 30_000;
const LOCAL_RUNTIME_ROOT = process.env.VERCEL === "1" ? path.join(tmpdir(), "signal-console") : path.join(/*turbopackIgnore: true*/ process.cwd(), ".local");
const LIVE_CONFIG_LOCAL_PATH = path.join(LOCAL_RUNTIME_ROOT, "signal-console-live-config.json");
const DATASET_STATUS_LOCAL_PATH = path.join(LOCAL_RUNTIME_ROOT, "signal-console-dataset-status.json");
const LIVE_CONFIG_COLLECTION = "signalConsoleConfig";
const DATASET_STATUS_COLLECTION = "signalConsoleDatasets";
const CRON_RUN_COLLECTION = "signalConsoleCronRuns";

type LiveConfigCache = { loadedAt: number; value: Promise<LiveConfig> } | null;
type DatasetStatusCache = { loadedAt: number; value: Promise<DatasetStatus | null> } | null;

let liveConfigCache: LiveConfigCache = null;
let datasetStatusCache: DatasetStatusCache = null;

export type SavedStrategyEdit = {
  contracts?: number;
  riskDollars?: number;
  scale?: number;
  slUnits?: number;
  targetDollars?: number;
  tpUnits?: number;
};

export type LiveMarket = "forex" | "futures" | "gold_spot";
export type DashboardMarket = "forex" | "futures";
export type ChallengeRulesMarket = DashboardMarket;
export type SavedDatasetIdsByMarket = Partial<Record<DashboardMarket, string[]>>;
export type SavedStrategyIdsByMarket = SavedDatasetIdsByMarket;
export const DASHBOARD_MARKETS: DashboardMarket[] = ["forex", "futures"];

export type SavedCustomScaleRange = {
  riskCeiling?: string;
  riskFloor?: string;
  targetCeiling?: string;
  targetFloor?: string;
};

export type SavedCustomScaleRanges = Partial<Record<LiveMarket, SavedCustomScaleRange>>;

export type SavedChallengeRules = {
  dailyLossLimit?: number;
  dailyLossStop?: number;
  dailyProfitLock?: number;
  maximumLossLimit?: number;
  profitTarget?: number;
  startingBalance?: number;
};

export type SavedChallengeRulesByMarket = Partial<Record<ChallengeRulesMarket, SavedChallengeRules>>;

export type SavedTheme = "dark" | "light";

export type SavedDashboardSettings = {
  activeMarket?: DashboardMarket;
  challengeRules?: SavedChallengeRules;
  challengeRulesByMarket?: SavedChallengeRulesByMarket;
  theme?: SavedTheme;
};

export type LiveConfig = {
  customScaleRanges: SavedCustomScaleRanges;
  dashboardSettings: SavedDashboardSettings;
  dashboardSelectedStrategyIdsByMarket: SavedStrategyIdsByMarket;
  dashboardSelectedStrategyIds: string[];
  enabledStrategyIdsByMarket: SavedStrategyIdsByMarket;
  enabledStrategyIds: string[];
  /** Legacy field names kept so old config documents and scripts continue to work. */
  dashboardSelectedDatasetIdsByMarket: SavedDatasetIdsByMarket;
  dashboardSelectedDatasetIds: string[];
  enabledDatasetIdsByMarket: SavedDatasetIdsByMarket;
  enabledDatasetIds: string[];
  strategyEdits: Record<string, SavedStrategyEdit>;
  updatedAt?: string;
};

export type DatasetStatus = {
  assetCoverage?: Record<string, DatasetAssetCoverage>;
  backtestManifestPath: string;
  dataPrefix: string;
  lastSyncAt: string;
  strategyPrefix: string;
  sync?: SyncStatus;
  uploadedFilesCount: number;
  updatedAt?: string;
};

export type SyncStatus = {
  dataValidityRefresh?: SyncRunStatus;
  lastDataValidityRefreshAt?: string;
  lastMarketDataSyncAt?: string;
  lastResearchCycleAt?: string;
  lastSignalTradeCheckAt?: string;
  marketDataSync?: SyncRunStatus;
  researchCycle?: SyncRunStatus;
  researchStages?: Partial<Record<ResearchStageKey, SyncRunStatus>>;
  signalTradeCheck?: SyncRunStatus;
};

export type SyncRunKey = "dataValidityRefresh" | "marketDataSync" | "researchCycle" | "signalTradeCheck";
export type SyncRunState = "idle" | "running" | "success" | "failed";
export type SyncTimestampField = "lastDataValidityRefreshAt" | "lastMarketDataSyncAt" | "lastResearchCycleAt" | "lastSignalTradeCheckAt";
export type ResearchStageKey = "research" | "idea" | "coding" | "backtest";

export type SyncRunStatus = {
  durationMs?: number;
  error?: string;
  finishedAt?: string;
  jobsLastRun?: number;
  startedAt?: string;
  stage?: string;
  state: SyncRunState;
};

export type DatasetAssetCoverage = {
  dataFile: string;
  firstBarAt?: string;
  lastBarAt?: string;
  rows: number;
  symbol: string;
  timeframes: string[];
  updatedAt: string;
};

function normalizedStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function uniqueStringArray(value: string[]): string[] {
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function firstNonEmptyStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    const normalized = uniqueStringArray(normalizedStringArray(value));
    if (normalized.length) return normalized;
  }
  return [];
}

function normalizedDatasetIdsByMarket(value: unknown): SavedDatasetIdsByMarket {
  if (!value || typeof value !== "object") return {};
  const source = value as Partial<Record<DashboardMarket, unknown>>;
  const byMarket: SavedDatasetIdsByMarket = {};
  const forex = uniqueStringArray(normalizedStringArray(source.forex));
  const futures = uniqueStringArray(normalizedStringArray(source.futures));

  if (forex.length) byMarket.forex = forex;
  if (futures.length) byMarket.futures = futures;

  return byMarket;
}

function hasMarketIds(value: SavedDatasetIdsByMarket): boolean {
  return DASHBOARD_MARKETS.some((market) => (value[market]?.length ?? 0) > 0);
}

function firstNonEmptyIdsByMarket(...values: unknown[]): SavedDatasetIdsByMarket {
  for (const value of values) {
    const normalized = normalizedDatasetIdsByMarket(value);
    if (hasMarketIds(normalized)) return normalized;
  }
  return {};
}

function flattenIdsByMarket(byMarket: SavedDatasetIdsByMarket): string[] {
  return uniqueStringArray(DASHBOARD_MARKETS.flatMap((market) => byMarket[market] ?? []));
}

function normalizedMarket(value: unknown): LiveMarket | undefined {
  return value === "forex" || value === "futures" || value === "gold_spot" ? value : undefined;
}

function normalizedDashboardMarket(value: unknown): DashboardMarket | undefined {
  if (value === "gold_spot") return "forex";
  return value === "forex" || value === "futures" ? value : undefined;
}

function normalizedTheme(value: unknown): SavedTheme | undefined {
  return value === "dark" || value === "light" ? value : undefined;
}

function normalizedStrategyEdits(value: unknown): Record<string, SavedStrategyEdit> {
  if (!value || typeof value !== "object") return {};
  const entries = Object.entries(value as Record<string, SavedStrategyEdit>).filter(([key]) => key.trim().length > 0);
  return Object.fromEntries(entries);
}

function normalizedRangeValue(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  if (!text) return undefined;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? text : undefined;
}

function normalizedCustomScaleRange(value: unknown): SavedCustomScaleRange | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<Record<keyof SavedCustomScaleRange, unknown>>;
  const range: SavedCustomScaleRange = {};
  const targetFloor = normalizedRangeValue(source.targetFloor);
  const targetCeiling = normalizedRangeValue(source.targetCeiling);
  const riskFloor = normalizedRangeValue(source.riskFloor);
  const riskCeiling = normalizedRangeValue(source.riskCeiling);

  if (targetFloor !== undefined) range.targetFloor = targetFloor;
  if (targetCeiling !== undefined) range.targetCeiling = targetCeiling;
  if (riskFloor !== undefined) range.riskFloor = riskFloor;
  if (riskCeiling !== undefined) range.riskCeiling = riskCeiling;

  return Object.keys(range).length ? range : undefined;
}

function normalizedPositiveSetting(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100) / 100 : undefined;
}

function normalizedNonNegativeSetting(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) / 100 : undefined;
}

function normalizedChallengeRules(value: unknown): SavedChallengeRules | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<Record<keyof SavedChallengeRules, unknown>>;
  const rules: SavedChallengeRules = {};
  const startingBalance = normalizedPositiveSetting(source.startingBalance);
  const profitTarget = normalizedPositiveSetting(source.profitTarget);
  const maximumLossLimit = normalizedNonNegativeSetting(source.maximumLossLimit);
  const dailyLossLimit = normalizedNonNegativeSetting(source.dailyLossLimit);
  const dailyProfitLock = normalizedNonNegativeSetting(source.dailyProfitLock);
  const dailyLossStop = normalizedNonNegativeSetting(source.dailyLossStop);

  if (startingBalance !== undefined) rules.startingBalance = startingBalance;
  if (profitTarget !== undefined) rules.profitTarget = profitTarget;
  if (maximumLossLimit !== undefined) rules.maximumLossLimit = maximumLossLimit;
  if (dailyLossLimit !== undefined) rules.dailyLossLimit = dailyLossLimit;
  if (dailyProfitLock !== undefined) rules.dailyProfitLock = dailyProfitLock;
  if (dailyLossStop !== undefined) rules.dailyLossStop = dailyLossStop;

  return Object.keys(rules).length ? rules : undefined;
}

function normalizedChallengeRulesByMarket(value: unknown): SavedChallengeRulesByMarket | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<Record<ChallengeRulesMarket, unknown>>;
  const rulesByMarket: SavedChallengeRulesByMarket = {};
  const forex = normalizedChallengeRules(source.forex);
  const futures = normalizedChallengeRules(source.futures);

  if (forex) rulesByMarket.forex = forex;
  if (futures) rulesByMarket.futures = futures;

  return Object.keys(rulesByMarket).length ? rulesByMarket : undefined;
}

function normalizedDashboardSettings(value: unknown): SavedDashboardSettings {
  if (!value || typeof value !== "object") return {};
  const source = value as Partial<SavedDashboardSettings>;
  const settings: SavedDashboardSettings = {};
  const activeMarket = normalizedDashboardMarket(source.activeMarket);
  const theme = normalizedTheme(source.theme);
  const challengeRules = normalizedChallengeRules(source.challengeRules);
  const challengeRulesByMarket = normalizedChallengeRulesByMarket(source.challengeRulesByMarket);

  if (activeMarket) settings.activeMarket = activeMarket;
  if (theme) settings.theme = theme;
  if (challengeRules) settings.challengeRules = challengeRules;
  if (challengeRulesByMarket) settings.challengeRulesByMarket = challengeRulesByMarket;

  return settings;
}

function normalizedCustomScaleRanges(value: unknown): SavedCustomScaleRanges {
  if (!value || typeof value !== "object") return {};
  const source = value as Partial<Record<LiveMarket, unknown>>;
  const ranges: SavedCustomScaleRanges = {};
  const forex = normalizedCustomScaleRange(source.forex);
  const futures = normalizedCustomScaleRange(source.futures);
  const goldSpot = normalizedCustomScaleRange(source.gold_spot);

  if (forex) ranges.forex = forex;
  if (futures) ranges.futures = futures;
  if (goldSpot) ranges.gold_spot = goldSpot;

  return ranges;
}

function normalizeLiveConfig(value: Partial<LiveConfig> | null | undefined): LiveConfig {
  const enabledStrategyIdsByMarket = firstNonEmptyIdsByMarket(value?.enabledStrategyIdsByMarket, value?.enabledDatasetIdsByMarket);
  const dashboardSelectedStrategyIdsByMarket = firstNonEmptyIdsByMarket(
    value?.dashboardSelectedStrategyIdsByMarket,
    value?.dashboardSelectedDatasetIdsByMarket
  );
  const enabledStrategyIds = firstNonEmptyStringArray(value?.enabledStrategyIds, value?.enabledDatasetIds);
  const dashboardSelectedStrategyIds = firstNonEmptyStringArray(value?.dashboardSelectedStrategyIds, value?.dashboardSelectedDatasetIds);

  return {
    customScaleRanges: normalizedCustomScaleRanges(value?.customScaleRanges),
    dashboardSettings: normalizedDashboardSettings(value?.dashboardSettings),
    dashboardSelectedStrategyIdsByMarket,
    dashboardSelectedStrategyIds,
    enabledStrategyIdsByMarket,
    enabledStrategyIds,
    dashboardSelectedDatasetIdsByMarket: dashboardSelectedStrategyIdsByMarket,
    dashboardSelectedDatasetIds: dashboardSelectedStrategyIds,
    enabledDatasetIdsByMarket: enabledStrategyIdsByMarket,
    enabledDatasetIds: enabledStrategyIds,
    strategyEdits: normalizedStrategyEdits(value?.strategyEdits),
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : undefined
  };
}

export function enabledStrategyIdsForMarket(config: LiveConfig, market: DashboardMarket): string[] {
  return config.enabledStrategyIdsByMarket[market] ?? config.enabledStrategyIds;
}

export function dashboardSelectedStrategyIdsForMarket(config: LiveConfig, market: DashboardMarket): string[] {
  return config.dashboardSelectedStrategyIdsByMarket[market] ?? config.dashboardSelectedStrategyIds;
}

export function selectedLiveStrategyIds(config: LiveConfig): string[] {
  const enabledByMarket = flattenIdsByMarket(config.enabledStrategyIdsByMarket);
  if (enabledByMarket.length) return enabledByMarket;

  const dashboardSelectedByMarket = flattenIdsByMarket(config.dashboardSelectedStrategyIdsByMarket);
  if (dashboardSelectedByMarket.length) return dashboardSelectedByMarket;

  return config.enabledStrategyIds.length ? config.enabledStrategyIds : config.dashboardSelectedStrategyIds;
}

export function withSavedStrategySelection(
  config: LiveConfig,
  selectedStrategyIds: string[],
  options: { market?: DashboardMarket; scopeStrategyIds?: string[] } = {}
): LiveConfig {
  const selected = uniqueStringArray(selectedStrategyIds);

  if (options.market) {
    const enabledStrategyIdsByMarket: SavedStrategyIdsByMarket = {
      ...config.enabledStrategyIdsByMarket,
      [options.market]: selected
    };
    const dashboardSelectedStrategyIdsByMarket: SavedStrategyIdsByMarket = {
      ...config.dashboardSelectedStrategyIdsByMarket,
      [options.market]: selected
    };

    return normalizeLiveConfig({
      ...config,
      dashboardSelectedStrategyIdsByMarket,
      dashboardSelectedStrategyIds: flattenIdsByMarket(dashboardSelectedStrategyIdsByMarket),
      enabledStrategyIdsByMarket,
      enabledStrategyIds: flattenIdsByMarket(enabledStrategyIdsByMarket)
    });
  }

  const scope = options.scopeStrategyIds?.length ? new Set(uniqueStringArray(options.scopeStrategyIds)) : null;
  const enabledStrategyIds = scope
    ? [...config.enabledStrategyIds.filter((key) => !scope.has(key)), ...selected]
    : selected;
  const dashboardSelectedStrategyIds = scope
    ? [...config.dashboardSelectedStrategyIds.filter((key) => !scope.has(key)), ...selected]
    : selected;

  return normalizeLiveConfig({
    ...config,
    dashboardSelectedStrategyIds,
    dashboardSelectedStrategyIdsByMarket: normalizedDatasetIdsByMarket({}),
    enabledStrategyIds,
    enabledStrategyIdsByMarket: normalizedDatasetIdsByMarket({})
  });
}

function normalizeDatasetStatus(value: Partial<DatasetStatus> | null | undefined): DatasetStatus | null {
  if (!value) return null;
  if (
    typeof value.backtestManifestPath !== "string" ||
    typeof value.dataPrefix !== "string" ||
    typeof value.lastSyncAt !== "string" ||
    typeof value.strategyPrefix !== "string" ||
    typeof value.uploadedFilesCount !== "number"
  ) {
    return null;
  }
  return {
    assetCoverage: normalizeAssetCoverage(value.assetCoverage),
    backtestManifestPath: value.backtestManifestPath,
    dataPrefix: value.dataPrefix,
    lastSyncAt: value.lastSyncAt,
    strategyPrefix: value.strategyPrefix,
    sync: value.sync ? normalizeSyncStatus(value.sync) : undefined,
    uploadedFilesCount: value.uploadedFilesCount,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined
  };
}

function normalizeSyncStatus(value: unknown): SyncStatus {
  const source = value && typeof value === "object" ? (value as Partial<SyncStatus>) : {};
  const status: SyncStatus = {};
  const dataValidityRefresh = normalizeSyncRunStatus(source.dataValidityRefresh);
  const marketDataSync = normalizeSyncRunStatus(source.marketDataSync);
  const researchCycle = normalizeSyncRunStatus(source.researchCycle);
  const researchStages = normalizeResearchStages(source.researchStages);
  const signalTradeCheck = normalizeSyncRunStatus(source.signalTradeCheck);

  if (dataValidityRefresh) {
    status.dataValidityRefresh = dataValidityRefresh;
  }

  if (marketDataSync) {
    status.marketDataSync = marketDataSync;
  }

  if (researchCycle) {
    status.researchCycle = researchCycle;
  }

  if (researchStages) {
    status.researchStages = researchStages;
  }

  if (signalTradeCheck) {
    status.signalTradeCheck = signalTradeCheck;
  }

  if (typeof source.lastDataValidityRefreshAt === "string") {
    status.lastDataValidityRefreshAt = source.lastDataValidityRefreshAt;
  }

  if (typeof source.lastMarketDataSyncAt === "string") {
    status.lastMarketDataSyncAt = source.lastMarketDataSyncAt;
  }

  if (typeof source.lastResearchCycleAt === "string") {
    status.lastResearchCycleAt = source.lastResearchCycleAt;
  }

  if (typeof source.lastSignalTradeCheckAt === "string") {
    status.lastSignalTradeCheckAt = source.lastSignalTradeCheckAt;
  }

  return status;
}

function isResearchStageKey(value: unknown): value is ResearchStageKey {
  return value === "research" || value === "idea" || value === "coding" || value === "backtest";
}

function normalizeResearchStages(value: unknown): Partial<Record<ResearchStageKey, SyncRunStatus>> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<Record<ResearchStageKey, unknown>>;
  const stages: Partial<Record<ResearchStageKey, SyncRunStatus>> = {};

  for (const stage of ["research", "idea", "coding", "backtest"] as const) {
    const normalized = normalizeSyncRunStatus(source[stage]);
    if (normalized) {
      stages[stage] = {
        ...normalized,
        stage
      };
    }
  }

  return Object.keys(stages).length ? stages : undefined;
}

function normalizeSyncRunStatus(value: unknown): SyncRunStatus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<SyncRunStatus>;
  const explicitState = source.state === "idle" || source.state === "running" || source.state === "success" || source.state === "failed"
    ? source.state
    : undefined;
  const startedAt = typeof source.startedAt === "string" ? source.startedAt : undefined;
  const finishedAt = typeof source.finishedAt === "string" ? source.finishedAt : undefined;
  const error = typeof source.error === "string" && source.error.trim() ? source.error.trim().slice(0, 800) : undefined;
  const durationMs = typeof source.durationMs === "number" && Number.isFinite(source.durationMs) && source.durationMs >= 0
    ? Math.round(source.durationMs)
    : undefined;
  const jobsLastRun = typeof source.jobsLastRun === "number" && Number.isFinite(source.jobsLastRun) && source.jobsLastRun >= 0
    ? Math.round(source.jobsLastRun)
    : undefined;
  const stage = typeof source.stage === "string" ? source.stage : undefined;
  const state: SyncRunState = explicitState ?? (error ? "failed" : finishedAt ? "success" : startedAt ? "running" : "idle");

  if (state === "idle" && !startedAt && !finishedAt && !error && durationMs === undefined && jobsLastRun === undefined) {
    return undefined;
  }

  return {
    durationMs,
    error,
    finishedAt,
    jobsLastRun,
    startedAt,
    stage,
    state
  };
}

function normalizeAssetCoverage(value: unknown): Record<string, DatasetAssetCoverage> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, Partial<DatasetAssetCoverage>>)
      .filter(([, coverage]) => coverage && typeof coverage === "object")
      .map(([key, coverage]) => [
        key,
        {
          dataFile: typeof coverage.dataFile === "string" ? coverage.dataFile : "",
          firstBarAt: typeof coverage.firstBarAt === "string" ? coverage.firstBarAt : undefined,
          lastBarAt: typeof coverage.lastBarAt === "string" ? coverage.lastBarAt : undefined,
          rows: typeof coverage.rows === "number" ? coverage.rows : 0,
          symbol: typeof coverage.symbol === "string" ? coverage.symbol : key,
          timeframes: normalizedStringArray(coverage.timeframes),
          updatedAt: typeof coverage.updatedAt === "string" ? coverage.updatedAt : new Date(0).toISOString()
        }
      ])
  );
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function readLiveConfigFromLocal(): Promise<LiveConfig> {
  return normalizeLiveConfig(await readJsonFile<LiveConfig>(LIVE_CONFIG_LOCAL_PATH));
}

async function readLiveConfigFromFirestore(): Promise<LiveConfig> {
  const snapshot = await firebaseDb().collection(LIVE_CONFIG_COLLECTION).doc("default").get();
  return normalizeLiveConfig(snapshot.data() as Partial<LiveConfig> | undefined);
}

async function readLiveConfigFromTurso(): Promise<LiveConfig> {
  const doc = await getTursoDocument(LIVE_CONFIG_COLLECTION, "default");
  return normalizeLiveConfig(doc?.payload as Partial<LiveConfig> | undefined);
}

async function readLiveConfigFromStorage(): Promise<LiveConfig> {
  if (tursoConfigured()) {
    try {
      return await readLiveConfigFromTurso();
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      return await withFirebaseTimeout(readLiveConfigFromFirestore(), "Firebase live config read");
    } catch {
      return readLiveConfigFromLocal();
    }
  }
  return readLiveConfigFromLocal();
}

async function readDatasetStatusFromLocal(): Promise<DatasetStatus | null> {
  return normalizeDatasetStatus(await readJsonFile<DatasetStatus>(DATASET_STATUS_LOCAL_PATH));
}

async function readDatasetStatusFromFirestore(): Promise<DatasetStatus | null> {
  const snapshot = await firebaseDb().collection(DATASET_STATUS_COLLECTION).doc("runtime").get();
  return normalizeDatasetStatus(snapshot.data() as Partial<DatasetStatus> | undefined);
}

async function readDatasetStatusFromTurso(): Promise<DatasetStatus | null> {
  const doc = await getTursoDocument(DATASET_STATUS_COLLECTION, "runtime");
  return normalizeDatasetStatus(doc?.payload as Partial<DatasetStatus> | undefined);
}

async function readDatasetStatusFromStorage(): Promise<DatasetStatus | null> {
  if (tursoConfigured()) {
    try {
      return await readDatasetStatusFromTurso();
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      return await withFirebaseTimeout(readDatasetStatusFromFirestore(), "Firebase dataset status read");
    } catch {
      return readDatasetStatusFromLocal();
    }
  }
  return readDatasetStatusFromLocal();
}

export async function getLiveConfig(): Promise<LiveConfig> {
  const now = Date.now();
  if (!liveConfigCache || now - liveConfigCache.loadedAt > LIVE_CONFIG_CACHE_TTL_MS) {
    liveConfigCache = {
      loadedAt: now,
      value: readLiveConfigFromStorage()
    };
  }
  return liveConfigCache.value;
}

export async function saveLiveConfig(config: LiveConfig): Promise<LiveConfig> {
  const normalized = normalizeLiveConfig({
    ...config,
    updatedAt: new Date().toISOString()
  });
  const firestorePayload = omitUndefinedDeep(normalized);

  if (tursoConfigured()) {
    try {
      await saveTursoDocument({
        collection: LIVE_CONFIG_COLLECTION,
        id: "default",
        payload: firestorePayload
      });
      liveConfigCache = {
        loadedAt: Date.now(),
        value: Promise.resolve(normalized)
      };
      return normalized;
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb()
          .collection(LIVE_CONFIG_COLLECTION)
          .doc("default")
          .set({
            ...firestorePayload,
            updatedAtServer: FieldValue.serverTimestamp()
          }),
        "Firebase live config write"
      );
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
      await writeJsonFile(LIVE_CONFIG_LOCAL_PATH, normalized);
    }
  } else {
    await writeJsonFile(LIVE_CONFIG_LOCAL_PATH, normalized);
  }

  liveConfigCache = {
    loadedAt: Date.now(),
    value: Promise.resolve(normalized)
  };

  return normalized;
}

export async function getDatasetStatus(): Promise<DatasetStatus | null> {
  const now = Date.now();
  if (!datasetStatusCache || now - datasetStatusCache.loadedAt > DATASET_STATUS_CACHE_TTL_MS) {
    datasetStatusCache = {
      loadedAt: now,
      value: readDatasetStatusFromStorage()
    };
  }
  return datasetStatusCache.value;
}

export async function saveDatasetStatus(status: DatasetStatus): Promise<DatasetStatus> {
  const normalized: DatasetStatus = {
    ...status,
    sync: normalizeSyncStatus(status.sync),
    updatedAt: new Date().toISOString()
  };
  const firestorePayload = omitUndefinedDeep(normalized);

  if (tursoConfigured()) {
    try {
      await saveTursoDocument({
        collection: DATASET_STATUS_COLLECTION,
        id: "runtime",
        payload: firestorePayload,
        sortTimeMillis: Date.parse(normalized.updatedAt ?? normalized.lastSyncAt)
      });
      datasetStatusCache = {
        loadedAt: Date.now(),
        value: Promise.resolve(normalized)
      };
      return normalized;
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb()
          .collection(DATASET_STATUS_COLLECTION)
          .doc("runtime")
          .set({
            ...firestorePayload,
            updatedAtServer: FieldValue.serverTimestamp()
          }),
        "Firebase dataset status write"
      );
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
      await writeJsonFile(DATASET_STATUS_LOCAL_PATH, normalized);
    }
  } else {
    await writeJsonFile(DATASET_STATUS_LOCAL_PATH, normalized);
  }

  datasetStatusCache = {
    loadedAt: Date.now(),
    value: Promise.resolve(normalized)
  };

  return normalized;
}

export async function updateDatasetSyncStatus(field: SyncTimestampField, timestamp = new Date().toISOString()): Promise<DatasetStatus> {
  const existing = (await getDatasetStatus()) ?? defaultDatasetStatus();
  return saveDatasetStatus({
    ...existing,
    sync: {
      ...(existing.sync ?? {}),
      [field]: timestamp
    }
  });
}

const SYNC_TIMESTAMP_FIELD_BY_RUN_KEY: Record<SyncRunKey, SyncTimestampField> = {
  dataValidityRefresh: "lastDataValidityRefreshAt",
  marketDataSync: "lastMarketDataSyncAt",
  researchCycle: "lastResearchCycleAt",
  signalTradeCheck: "lastSignalTradeCheckAt"
};

export async function updateDatasetSyncRunStatus(
  runKey: SyncRunKey,
  runStatus: Partial<SyncRunStatus> & { state: SyncRunState }
): Promise<DatasetStatus> {
  const existing = (await getDatasetStatus()) ?? defaultDatasetStatus();
  const previousRun = runStatus.state === "running" ? undefined : existing.sync?.[runKey];
  const normalizedRun = normalizeSyncRunStatus({
    ...(previousRun ?? {}),
    ...runStatus
  });
  const sync: SyncStatus = {
    ...(existing.sync ?? {})
  };

  if (normalizedRun) {
    sync[runKey] = normalizedRun;
  }

  if (runKey === "researchCycle" && isResearchStageKey(runStatus.stage)) {
    const previousStageRun = runStatus.state === "running" ? undefined : existing.sync?.researchStages?.[runStatus.stage];
    const normalizedStageRun = normalizeSyncRunStatus({
      ...(previousStageRun ?? {}),
      ...runStatus,
      stage: runStatus.stage
    });

    if (normalizedStageRun) {
      sync.researchStages = {
        ...(existing.sync?.researchStages ?? {}),
        [runStatus.stage]: normalizedStageRun
      };
    }
  }

  if (runStatus.state === "success" && runStatus.finishedAt) {
    sync[SYNC_TIMESTAMP_FIELD_BY_RUN_KEY[runKey]] = runStatus.finishedAt;
  }

  return saveDatasetStatus({
    ...existing,
    sync
  });
}

export async function saveCronRun(result: CronResult): Promise<void> {
  const payload = {
    ...result,
    generatedCount: result.generated.length,
    skippedDuplicateCount: result.skippedDuplicates.length,
    skippedRiskCount: result.skippedRisk.length,
    errorCount: result.errors.length,
    createdAt: new Date().toISOString()
  };
  const safePayload = omitUndefinedDeep(payload);

  if (tursoConfigured()) {
    try {
      await saveTursoDocument({
        collection: CRON_RUN_COLLECTION,
        id: result.checkedAt.replace(/[^0-9A-Za-z_-]/g, "_"),
        payload: safePayload,
        sortTimeMillis: Date.parse(payload.createdAt)
      });
      return;
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    await firebaseDb()
      .collection(CRON_RUN_COLLECTION)
      .doc(result.checkedAt.replace(/[^0-9A-Za-z_-]/g, "_"))
      .set({
        ...safePayload,
        createdAtServer: FieldValue.serverTimestamp()
      });
    return;
  }

  const localPath = path.join(LOCAL_RUNTIME_ROOT, "signal-console-cron-runs.json");
  const existing = (await readJsonFile<typeof safePayload[]>(localPath)) ?? [];
  await writeJsonFile(localPath, [safePayload, ...existing].slice(0, 100));
}

export function defaultDatasetStatus(): DatasetStatus {
  const backtestManifestPath = r2Configured() ? r2ObjectKey("cache/backtest-manifest.json") : storageObjectPath("cache/backtest-manifest.json");
  const dataPrefix = r2Configured() ? r2ObjectKey("data") : storageObjectPath("data");
  const strategyPrefix = r2Configured() ? r2ObjectKey("strategy") : storageObjectPath("strategy");

  return {
    assetCoverage: {},
    backtestManifestPath,
    dataPrefix,
    lastSyncAt: new Date(0).toISOString(),
    strategyPrefix,
    sync: {},
    uploadedFilesCount: 0
  };
}
