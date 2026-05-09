import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseDb, hasFirebaseAdmin, storageObjectPath } from "@/lib/firebase-admin";
import type { CronResult } from "@/lib/types";

const LIVE_CONFIG_CACHE_TTL_MS = 30_000;
const DATASET_STATUS_CACHE_TTL_MS = 30_000;
const LIVE_CONFIG_LOCAL_PATH = path.join(process.cwd(), ".local", "signal-console-live-config.json");
const DATASET_STATUS_LOCAL_PATH = path.join(process.cwd(), ".local", "signal-console-dataset-status.json");
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
  slUnits?: number;
  targetDollars?: number;
  tpUnits?: number;
};

export type LiveMarket = "forex" | "futures" | "gold_spot";
export type DashboardMarket = "forex" | "futures";
export type ChallengeRulesMarket = DashboardMarket;

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
  dashboardSelectedDatasetIds: string[];
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
  lastSignalTradeCheckAt?: string;
  marketDataSync?: SyncRunStatus;
  signalTradeCheck?: SyncRunStatus;
};

export type SyncRunKey = "dataValidityRefresh" | "marketDataSync" | "signalTradeCheck";
export type SyncRunState = "idle" | "running" | "success" | "failed";
export type SyncTimestampField = "lastDataValidityRefreshAt" | "lastMarketDataSyncAt" | "lastSignalTradeCheckAt";

export type SyncRunStatus = {
  durationMs?: number;
  error?: string;
  finishedAt?: string;
  startedAt?: string;
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

function omitUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => omitUndefinedDeep(item)) as T;
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, omitUndefinedDeep(child)])
    ) as T;
  }

  return value;
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
  return {
    customScaleRanges: normalizedCustomScaleRanges(value?.customScaleRanges),
    dashboardSettings: normalizedDashboardSettings(value?.dashboardSettings),
    dashboardSelectedDatasetIds: normalizedStringArray(value?.dashboardSelectedDatasetIds),
    enabledDatasetIds: normalizedStringArray(value?.enabledDatasetIds),
    strategyEdits: normalizedStrategyEdits(value?.strategyEdits),
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : undefined
  };
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
  const signalTradeCheck = normalizeSyncRunStatus(source.signalTradeCheck);

  if (dataValidityRefresh) {
    status.dataValidityRefresh = dataValidityRefresh;
  }

  if (marketDataSync) {
    status.marketDataSync = marketDataSync;
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

  if (typeof source.lastSignalTradeCheckAt === "string") {
    status.lastSignalTradeCheckAt = source.lastSignalTradeCheckAt;
  }

  return status;
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
  const state: SyncRunState = explicitState ?? (error ? "failed" : finishedAt ? "success" : startedAt ? "running" : "idle");

  if (state === "idle" && !startedAt && !finishedAt && !error && durationMs === undefined) {
    return undefined;
  }

  return {
    durationMs,
    error,
    finishedAt,
    startedAt,
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

async function readDatasetStatusFromLocal(): Promise<DatasetStatus | null> {
  return normalizeDatasetStatus(await readJsonFile<DatasetStatus>(DATASET_STATUS_LOCAL_PATH));
}

async function readDatasetStatusFromFirestore(): Promise<DatasetStatus | null> {
  const snapshot = await firebaseDb().collection(DATASET_STATUS_COLLECTION).doc("runtime").get();
  return normalizeDatasetStatus(snapshot.data() as Partial<DatasetStatus> | undefined);
}

export async function getLiveConfig(): Promise<LiveConfig> {
  const now = Date.now();
  if (!liveConfigCache || now - liveConfigCache.loadedAt > LIVE_CONFIG_CACHE_TTL_MS) {
    liveConfigCache = {
      loadedAt: now,
      value: hasFirebaseAdmin() ? readLiveConfigFromFirestore() : readLiveConfigFromLocal()
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

  if (hasFirebaseAdmin()) {
    await firebaseDb()
      .collection(LIVE_CONFIG_COLLECTION)
      .doc("default")
      .set({
        ...firestorePayload,
        updatedAtServer: FieldValue.serverTimestamp()
      });
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
      value: hasFirebaseAdmin() ? readDatasetStatusFromFirestore() : readDatasetStatusFromLocal()
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

  if (hasFirebaseAdmin()) {
    await firebaseDb()
      .collection(DATASET_STATUS_COLLECTION)
      .doc("runtime")
      .set({
        ...firestorePayload,
        updatedAtServer: FieldValue.serverTimestamp()
      });
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

  if (hasFirebaseAdmin()) {
    await firebaseDb()
      .collection(CRON_RUN_COLLECTION)
      .doc(result.checkedAt.replace(/[^0-9A-Za-z_-]/g, "_"))
      .set({
        ...payload,
        createdAtServer: FieldValue.serverTimestamp()
      });
    return;
  }

  const localPath = path.join(process.cwd(), ".local", "signal-console-cron-runs.json");
  const existing = (await readJsonFile<typeof payload[]>(localPath)) ?? [];
  await writeJsonFile(localPath, [payload, ...existing].slice(0, 100));
}

export function defaultDatasetStatus(): DatasetStatus {
  return {
    assetCoverage: {},
    backtestManifestPath: storageObjectPath("cache/backtest-manifest.json"),
    dataPrefix: storageObjectPath("data"),
    lastSyncAt: new Date(0).toISOString(),
    strategyPrefix: storageObjectPath("strategy"),
    sync: {},
    uploadedFilesCount: 0
  };
}
