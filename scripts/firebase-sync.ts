import { readdir } from "node:fs/promises";
import path from "node:path";
import { buildLocalStrategyCatalog } from "../src/lib/backtest";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath } from "../src/lib/firebase-admin";
import { defaultDatasetStatus, getLiveConfig, saveDatasetStatus, saveLiveConfig } from "../src/lib/live-config";

type UploadRoot = {
  include: (filePath: string) => boolean;
  root: string;
};

const UPLOAD_ROOTS: UploadRoot[] = [
  {
    root: "config",
    include: (filePath) => path.extname(filePath).toLowerCase() === ".json"
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

async function main(): Promise<void> {
  if (!hasFirebaseAdmin()) {
    throw new Error("Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or the split FIREBASE_* variables first.");
  }

  const files = unique(
    (
      await Promise.all(
        UPLOAD_ROOTS.map((entry) => walk(entry.root, entry.include))
      )
    ).flat()
  );

  const uploadedFilesCount = await uploadFiles(files);
  const catalog = await buildLocalStrategyCatalog();
  const generatedAt = new Date().toISOString();
  const manifestRelativePath = "cache/backtest-manifest.json";
  const manifestDestination = storageObjectPath(manifestRelativePath);
  const manifest = {
    catalogVersion: 1,
    generatedAt,
    ...catalog
  };

  await firebaseBucket()
    .file(manifestDestination)
    .save(JSON.stringify(manifest), {
      contentType: "application/json",
      resumable: false
    });

  const existingConfig = await getLiveConfig();
  const liveDatasetIds = catalog.entries
    .filter((entry) => entry.liveSupported && catalog.stats.some((stat) => stat.datasetId === entry.key))
    .map((entry) => entry.key);
  const dashboardDefault = liveDatasetIds.slice(0, 1);

  await saveLiveConfig({
    dashboardSelectedDatasetIds:
      existingConfig.dashboardSelectedDatasetIds.length > 0 ? existingConfig.dashboardSelectedDatasetIds : dashboardDefault,
    enabledDatasetIds: existingConfig.enabledDatasetIds.length > 0 ? existingConfig.enabledDatasetIds : liveDatasetIds,
    strategyEdits: existingConfig.strategyEdits
  });

  const fallbackStatus = defaultDatasetStatus();
  await saveDatasetStatus({
    backtestManifestPath: manifestDestination,
    dataPrefix: storageObjectPath("data"),
    lastSyncAt: generatedAt,
    strategyPrefix: storageObjectPath("strategy"),
    uploadedFilesCount: uploadedFilesCount + 1,
    updatedAt: fallbackStatus.updatedAt
  });

  console.log(`uploaded manifest ${manifestDestination}`);
  console.log(`uploaded files ${uploadedFilesCount + 1}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
