import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildLocalStrategyCatalog, type StrategyCatalog } from "../src/lib/backtest";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath } from "../src/lib/firebase-admin";
import { defaultDatasetStatus, getDatasetStatus, getLiveConfig, saveDatasetStatus, saveLiveConfig } from "../src/lib/live-config";

type UploadRoot = {
  include: (filePath: string) => boolean;
  root: string;
};

type RemoteFileInfo = {
  md5Hash?: string;
  size?: number;
};

type DataTailState = {
  tails?: Record<
    string,
    Record<
      string,
      {
        lastBarAt?: string;
        lastBarTime?: number;
      }
    >
  >;
};

type ComputedThroughMarker = {
  assetKey: string;
  lastBarAt?: string;
  lastBarTime?: number;
  timeframe: string;
};

const UPLOAD_ROOTS: UploadRoot[] = [
  {
    root: "config",
    include: (filePath) => path.extname(filePath).toLowerCase() === ".json"
  },
  {
    root: "Research",
    include: (filePath) => [".csv", ".json", ".md"].includes(path.extname(filePath).toLowerCase())
  },
  {
    root: "data",
    include: (filePath) => path.extname(filePath).toLowerCase() === ".csv"
  },
  {
    root: "strategy",
    include: (filePath) => [".csv", ".json"].includes(path.extname(filePath).toLowerCase())
  }
];

function selectedUploadRoots(): UploadRoot[] {
  const raw = process.argv.find((value) => value.startsWith("--roots="));
  if (!raw) return UPLOAD_ROOTS;

  const selectedNames = raw
    .slice("--roots=".length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!selectedNames.length) {
    throw new Error("The --roots argument must include at least one of: config, Research, data, strategy.");
  }

  const roots = selectedNames.map((name) => {
    const match = UPLOAD_ROOTS.find((entry) => entry.root === name);
    if (!match) {
      throw new Error(`Unknown upload root "${name}". Expected one of: config, Research, data, strategy.`);
    }
    return match;
  });

  return unique(roots);
}

function changedOnlyRequested(): boolean {
  return process.argv.includes("--changed-only");
}

function filesOnlyRequested(): boolean {
  return process.argv.includes("--files-only");
}

function selectedPathPrefixes(): string[] {
  const raw = process.argv.find((value) => value.startsWith("--path-prefixes="));
  if (!raw) return [];
  return unique(
    raw
      .slice("--path-prefixes=".length)
      .split(",")
      .map((value) => value.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, ""))
      .filter(Boolean)
  );
}

function selectedExactPaths(): string[] {
  const raw = process.argv.find((value) => value.startsWith("--paths="));
  if (!raw) return [];
  return unique(
    raw
      .slice("--paths=".length)
      .split(",")
      .map((value) => value.trim().replace(/\\/g, "/").replace(/^\/+/, ""))
      .filter(Boolean)
  );
}

function selectedComputedThroughStatePath(): string | undefined {
  const raw = process.argv.find((value) => value.startsWith("--computed-through-state="));
  return raw?.slice("--computed-through-state=".length).trim() || undefined;
}

function selectedCatalogStrategyIds(): string[] {
  const raw = process.argv.find((value) => value.startsWith("--catalog-strategy-ids="));
  if (!raw) return [];
  return unique(
    raw
      .slice("--catalog-strategy-ids=".length)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".csv") return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

async function walk(root: string, include: (filePath: string) => boolean): Promise<string[]> {
  const absoluteRoot = path.join(process.cwd(), root);
  const results: string[] = [];

  async function visit(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
      if (include(relativePath)) {
        results.push(relativePath);
      }
    }
  }

  await visit(absoluteRoot);
  return results.sort((left, right) => left.localeCompare(right));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function md5Base64(relativePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const digest = createHash("md5");
    const stream = createReadStream(path.join(process.cwd(), relativePath));

    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("end", () => resolve(digest.digest("base64")));
    stream.on("error", reject);
  });
}

async function remoteFilesForRoots(roots: UploadRoot[]): Promise<Map<string, RemoteFileInfo>> {
  const bucket = firebaseBucket();
  const remoteFiles = new Map<string, RemoteFileInfo>();

  for (const root of roots) {
    const [files] = await bucket.getFiles({ prefix: storageObjectPath(root.root) });
    for (const file of files) {
      const metadata = file.metadata.md5Hash || file.metadata.size ? file.metadata : (await file.getMetadata())[0];
      remoteFiles.set(file.name, {
        md5Hash: metadata.md5Hash,
        size: metadata.size ? Number(metadata.size) : undefined
      });
    }
  }

  return remoteFiles;
}

async function remoteFileForPath(relativePath: string): Promise<RemoteFileInfo | undefined> {
  const file = firebaseBucket().file(storageObjectPath(relativePath));
  try {
    const [metadata] = await file.getMetadata();
    return {
      md5Hash: metadata.md5Hash,
      size: metadata.size ? Number(metadata.size) : undefined
    };
  } catch {
    return undefined;
  }
}

async function filterChangedFiles(relativePaths: string[], roots: UploadRoot[], exactPathsMode = false): Promise<string[]> {
  if (!changedOnlyRequested()) {
    return relativePaths;
  }

  const remoteFiles = exactPathsMode ? new Map<string, RemoteFileInfo>() : await remoteFilesForRoots(roots);
  const changedPaths: string[] = [];
  let skippedCount = 0;

  for (const relativePath of relativePaths) {
    const destination = storageObjectPath(relativePath);
    const remoteFile = exactPathsMode ? await remoteFileForPath(relativePath) : remoteFiles.get(destination);
    if (!remoteFile) {
      changedPaths.push(relativePath);
      continue;
    }

    const localSize = (await stat(path.join(process.cwd(), relativePath))).size;
    if (remoteFile.size !== localSize) {
      changedPaths.push(relativePath);
      continue;
    }

    const localMd5Hash = await md5Base64(relativePath);
    if (remoteFile.md5Hash !== localMd5Hash) {
      changedPaths.push(relativePath);
      continue;
    }

    skippedCount += 1;
    console.log(`skipped unchanged ${destination}`);
  }

  console.log(`changed-only mode selected ${changedPaths.length} of ${relativePaths.length} files for upload`);
  console.log(`skipped unchanged files ${skippedCount}`);
  return changedPaths;
}

async function uploadFiles(relativePaths: string[]): Promise<number> {
  const bucket = firebaseBucket();
  let uploadedCount = 0;

  for (const relativePath of relativePaths) {
    const destination = storageObjectPath(relativePath);
    await bucket.upload(path.join(process.cwd(), relativePath), {
      destination,
      metadata: {
        cacheControl: "private, max-age=0, no-transform",
        contentType: contentType(relativePath)
      },
      resumable: false
    });
    uploadedCount += 1;
    console.log(`uploaded ${destination}`);
  }

  return uploadedCount;
}

async function readDataTailState(filePath: string | undefined): Promise<DataTailState | null> {
  if (!filePath) return null;
  return JSON.parse(await readFile(path.resolve(process.cwd(), filePath), "utf8")) as DataTailState;
}

async function readExistingManifestCatalog(): Promise<StrategyCatalog | null> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "cache", "backtest-manifest.json"), "utf8")) as StrategyCatalog;
  } catch {
    return null;
  }
}

function isoFromSeconds(value: number | undefined): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : undefined;
}

function mergeCatalog(base: StrategyCatalog, update: StrategyCatalog, changedStrategyIds: string[]): StrategyCatalog {
  const changed = new Set(changedStrategyIds);
  const trades = [
    ...base.trades.filter((trade) => !changed.has(trade.datasetId)),
    ...update.trades
  ].sort((left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime));

  return {
    entries: [
      ...base.entries.filter((entry) => !changed.has(entry.key)),
      ...update.entries
    ].sort((left, right) => left.key.localeCompare(right.key)),
    stats: [
      ...base.stats.filter((stat) => !changed.has(stat.datasetId)),
      ...update.stats
    ].sort((left, right) => left.datasetId.localeCompare(right.datasetId)),
    trades
  };
}

function latestTradeTime(catalog: StrategyCatalog): number {
  if (!catalog.trades.length) return 0;
  return Math.max(
    ...catalog.trades
      .flatMap((trade) => [trade.signalTime, trade.entryTime, trade.exitTime])
      .map((value) => Date.parse(value))
      .filter(Number.isFinite)
  );
}

function catalogSummary(manifest: StrategyCatalog & { computedThroughAt?: string; generatedAt?: string }) {
  const latestTradeMs = latestTradeTime(manifest);
  const latestTradeAt = latestTradeMs > 0 ? isoFromSeconds(Math.floor(latestTradeMs / 1000)) : undefined;
  return {
    catalogVersion: manifest.catalogVersion,
    ...(manifest.computedThroughAt ? { computedThroughAt: manifest.computedThroughAt } : {}),
    ...(manifest.computedThroughByStrategy ? { computedThroughByStrategy: manifest.computedThroughByStrategy } : {}),
    entries: manifest.entries,
    generatedAt: manifest.generatedAt,
    ...(latestTradeAt ? { latestTradeAt } : {}),
    stats: manifest.stats,
    tradeCount: manifest.trades.length
  };
}

async function main(): Promise<void> {
  if (!hasFirebaseAdmin()) {
    throw new Error("Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or the split FIREBASE_* variables first.");
  }

  const roots = selectedUploadRoots();
  const exactPaths = selectedExactPaths();
  const pathPrefixes = selectedPathPrefixes();
  const files = exactPaths.length
    ? exactPaths
    : unique(
        (
          await Promise.all(
            roots.map((entry) => walk(entry.root, entry.include))
          )
        ).flat()
      );
  const matchingFiles =
    pathPrefixes.length > 0
      ? files.filter((relativePath) => pathPrefixes.some((prefix) => relativePath.startsWith(prefix)))
      : files;
  const filesToUpload = await filterChangedFiles(matchingFiles, roots, exactPaths.length > 0);

  const uploadedFilesCount = await uploadFiles(filesToUpload);
  if (filesOnlyRequested()) {
    console.log(`uploaded files ${uploadedFilesCount}`);
    return;
  }

  const catalogStrategyIds = selectedCatalogStrategyIds();
  const localCatalog = await buildLocalStrategyCatalog(catalogStrategyIds.length ? catalogStrategyIds : undefined);
  const existingManifest = catalogStrategyIds.length ? await readExistingManifestCatalog() : null;
  const catalog = existingManifest ? mergeCatalog(existingManifest, localCatalog, catalogStrategyIds) : localCatalog;
  const dataTailState = await readDataTailState(selectedComputedThroughStatePath());
  const updatedComputedStrategyIds = catalogStrategyIds.length ? new Set(catalogStrategyIds) : null;
  const existingComputedEntries = Object.entries(existingManifest?.computedThroughByStrategy ?? {}) as Array<
    [string, ComputedThroughMarker]
  >;
  const updatedComputedEntries = catalog.entries
    .filter((entry) => !updatedComputedStrategyIds || updatedComputedStrategyIds.has(entry.key))
    .map((entry): [string, ComputedThroughMarker] | null => {
      const timeframe = entry.timeframes[0] ?? "15m";
      const tail = dataTailState?.tails?.[entry.assetKey]?.[timeframe];
      if (!tail?.lastBarTime) return null;
      return [
        entry.key,
        {
          assetKey: entry.assetKey,
          lastBarAt: tail.lastBarAt ?? isoFromSeconds(tail.lastBarTime),
          lastBarTime: tail.lastBarTime,
          timeframe
        }
      ];
    })
    .filter((entry): entry is [string, ComputedThroughMarker] => entry !== null);
  const computedThroughByStrategy = Object.fromEntries([...existingComputedEntries, ...updatedComputedEntries]);
  const computedThroughTimes: number[] = [];
  for (const entry of Object.values(computedThroughByStrategy)) {
    if (typeof entry.lastBarTime === "number" && Number.isFinite(entry.lastBarTime)) {
      computedThroughTimes.push(entry.lastBarTime);
    }
  }
  const computedThroughAt = computedThroughTimes.length ? isoFromSeconds(Math.min(...computedThroughTimes)) : undefined;
  const generatedAt = new Date().toISOString();
  const manifestRelativePath = "cache/backtest-manifest.json";
  const summaryRelativePath = "cache/backtest-summary.json";
  const manifestDestination = storageObjectPath(manifestRelativePath);
  const summaryDestination = storageObjectPath(summaryRelativePath);
  const manifest = {
    catalogVersion: 1,
    ...(computedThroughAt ? { computedThroughAt } : {}),
    ...(Object.keys(computedThroughByStrategy).length ? { computedThroughByStrategy } : {}),
    generatedAt,
    ...catalog
  };
  const summary = catalogSummary(manifest);

  await writeFile(path.join(process.cwd(), manifestRelativePath), JSON.stringify(manifest));
  await firebaseBucket()
    .file(manifestDestination)
    .save(JSON.stringify(manifest), {
      contentType: "application/json",
      resumable: false
    });

  await writeFile(path.join(process.cwd(), summaryRelativePath), JSON.stringify(summary));
  await firebaseBucket()
    .file(summaryDestination)
    .save(JSON.stringify(summary), {
      contentType: "application/json",
      resumable: false
    });

  const existingConfig = await getLiveConfig();
  const liveDatasetIds = catalog.entries
    .filter((entry) => entry.liveSupported && catalog.stats.some((stat) => stat.datasetId === entry.key))
    .map((entry) => entry.key);
  const dashboardDefault = liveDatasetIds.slice(0, 1);

  await saveLiveConfig({
    customScaleRanges: existingConfig.customScaleRanges,
    dashboardSettings: existingConfig.dashboardSettings,
    dashboardSelectedDatasetIds:
      existingConfig.dashboardSelectedDatasetIds.length > 0 ? existingConfig.dashboardSelectedDatasetIds : dashboardDefault,
    enabledDatasetIds: existingConfig.enabledDatasetIds.length > 0 ? existingConfig.enabledDatasetIds : liveDatasetIds,
    strategyEdits: existingConfig.strategyEdits
  });

  const fallbackStatus = defaultDatasetStatus();
  const existingStatus = (await getDatasetStatus()) ?? fallbackStatus;
  const dataValidityStartedAt = existingStatus.sync?.dataValidityRefresh?.startedAt;
  const dataValidityStartedMs = dataValidityStartedAt ? Date.parse(dataValidityStartedAt) : Number.NaN;
  const dataValidityDurationMs = Number.isFinite(dataValidityStartedMs)
    ? Math.max(0, Date.parse(generatedAt) - dataValidityStartedMs)
    : undefined;
  await saveDatasetStatus({
    ...existingStatus,
    backtestManifestPath: manifestDestination,
    dataPrefix: storageObjectPath("data"),
    lastSyncAt: generatedAt,
    strategyPrefix: storageObjectPath("strategy"),
    sync: {
      ...(existingStatus.sync ?? {}),
      dataValidityRefresh: {
        durationMs: dataValidityDurationMs,
        finishedAt: generatedAt,
        startedAt: dataValidityStartedAt ?? generatedAt,
        state: "success"
      },
      lastDataValidityRefreshAt: generatedAt
    },
    uploadedFilesCount: uploadedFilesCount + 2,
    updatedAt: generatedAt
  });

  console.log(`uploaded manifest ${manifestDestination}`);
  console.log(`uploaded summary ${summaryDestination}`);
  console.log(`uploaded files ${uploadedFilesCount + 2}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
