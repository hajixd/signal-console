import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assetsJson from "../config/assets.json";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath } from "../src/lib/firebase-admin";

type PullRoot = {
  include: (filePath: string) => boolean;
  root: string;
};

type AssetDefinition = {
  dataFile: string;
};

type DataTailState = {
  tails?: Record<
    string,
    Record<
      string,
      {
        lastBarTime?: number;
      }
    >
  >;
};

type TailDownloadOptions = {
  overlapDays: number;
  state: DataTailState | null;
  tailBytes: number;
  tailRows: number;
};

const DEFAULT_TAIL_ROWS = 0;
const DEFAULT_TAIL_BYTES = 512 * 1024;

const PULL_ROOTS: PullRoot[] = [
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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function selectedPullRoots(): PullRoot[] {
  const raw = process.argv.find((value) => value.startsWith("--roots="));
  if (!raw) return PULL_ROOTS;

  const selectedNames = raw
    .slice("--roots=".length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!selectedNames.length) {
    throw new Error("The --roots argument must include at least one of: config, data, strategy.");
  }

  return unique(
    selectedNames.map((name) => {
      const match = PULL_ROOTS.find((entry) => entry.root === name);
      if (!match) {
        throw new Error(`Unknown pull root "${name}". Expected one of: config, data, strategy.`);
      }
      return match;
    })
  );
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

function ignoreMissingRequested(): boolean {
  return process.argv.includes("--ignore-missing");
}

function selectedTailRows(): number {
  const raw = process.argv.find((value) => value.startsWith("--tail-rows="));
  if (!raw) return DEFAULT_TAIL_ROWS;
  const parsed = Number(raw.slice("--tail-rows=".length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TAIL_ROWS;
}

function selectedTailBytes(): number {
  const raw = process.argv.find((value) => value.startsWith("--tail-bytes="));
  if (!raw) return DEFAULT_TAIL_BYTES;
  const parsed = Number(raw.slice("--tail-bytes=".length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TAIL_BYTES;
}

function selectedTailSinceStatePath(): string | undefined {
  const raw = process.argv.find((value) => value.startsWith("--tail-since-state="));
  return raw?.slice("--tail-since-state=".length).trim() || undefined;
}

function selectedTailOverlapDays(): number {
  const raw = process.argv.find((value) => value.startsWith("--tail-overlap-days="));
  if (!raw) return 0;
  const parsed = Number(raw.slice("--tail-overlap-days=".length));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function relativePathFromStorageName(name: string): string | null {
  const rootPrefix = storageObjectPath("");
  const prefix = rootPrefix ? rootPrefix.replace(/\/+$/, "") + "/" : "";
  if (prefix && !name.startsWith(prefix)) return null;
  return name.slice(prefix.length).replace(/^\/+/, "");
}

async function downloadFile(storageName: string, relativePath: string): Promise<void> {
  const localPath = path.join(process.cwd(), relativePath);
  await mkdir(path.dirname(localPath), { recursive: true });
  const [buffer] = await firebaseBucket().file(storageName).download();
  await writeFile(localPath, buffer);
}

async function readTailState(filePath: string | undefined): Promise<DataTailState | null> {
  if (!filePath) return null;
  return JSON.parse(await readFile(path.resolve(process.cwd(), filePath), "utf8")) as DataTailState;
}

function dataPathParts(relativePath: string): { dataFile: string; timeframe: string } | null {
  const match = relativePath.match(/^data\/([^/]+)\/([^/]+\.csv)$/);
  return match ? { timeframe: match[1]!, dataFile: match[2]! } : null;
}

function assetKeyForDataFile(dataFile: string): string | undefined {
  const assets = assetsJson as Record<string, AssetDefinition>;
  return Object.entries(assets).find(([, asset]) => asset.dataFile === dataFile)?.[0];
}

function requiredTailStart(relativePath: string, options: TailDownloadOptions): number | undefined {
  const parts = dataPathParts(relativePath);
  if (!parts) return undefined;

  const assetKey = assetKeyForDataFile(parts.dataFile);
  const lastBarTime = assetKey ? options.state?.tails?.[assetKey]?.[parts.timeframe]?.lastBarTime : undefined;
  if (typeof lastBarTime !== "number" || !Number.isFinite(lastBarTime)) return undefined;

  return Math.max(0, Math.floor(lastBarTime - options.overlapDays * 24 * 60 * 60));
}

function firstDataTimestamp(text: string): number | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("time,")) continue;
    const timestamp = Number(trimmed.split(",", 1)[0]);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return undefined;
}

function normalizeCsvTail(text: string, tailRows: number, partialStart: boolean): string {
  const lines = text.trimEnd().split(/\r?\n/);
  const candidateLines = (partialStart ? lines.slice(1) : lines)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("time,"));
  const rows = tailRows > 0 ? candidateLines.slice(-tailRows) : candidateLines;
  return `time,open,high,low,close,volume\n${rows.join("\n")}\n`;
}

async function downloadCsvTailFile(storageName: string, relativePath: string, options: TailDownloadOptions): Promise<void> {
  const localPath = path.join(process.cwd(), relativePath);
  await mkdir(path.dirname(localPath), { recursive: true });

  const file = firebaseBucket().file(storageName);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    await writeFile(localPath, "time,open,high,low,close,volume\n", "utf8");
    return;
  }

  const requiredStart = requiredTailStart(relativePath, options);
  let byteCount = Math.min(size, Math.max(options.tailBytes, options.tailRows * 128));
  let selectedText = "";
  let selectedFirstTime: number | undefined;

  while (true) {
    const start = Math.max(0, size - byteCount);
    const [buffer] = await file.download({
      start,
      validation: false
    });
    const text = normalizeCsvTail(buffer.toString("utf8"), options.tailRows, start > 0);
    selectedText = text;
    selectedFirstTime = firstDataTimestamp(text);

    if (requiredStart === undefined || selectedFirstTime === undefined || selectedFirstTime <= requiredStart || start === 0) {
      break;
    }

    byteCount = Math.min(size, byteCount * 2);
  }

  await writeFile(localPath, selectedText, "utf8");
  const rows = Math.max(0, selectedText.trimEnd().split(/\r?\n/).length - 1);
  console.log(
    `downloaded tail ${storageName} -> ${relativePath} (${rows} rows, first ${selectedFirstTime ?? "unknown"}, bytes ${byteCount})`
  );
}

async function main(): Promise<void> {
  if (!hasFirebaseAdmin()) {
    throw new Error("Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or the split FIREBASE_* variables first.");
  }

  const exactPaths = selectedExactPaths();
  const ignoreMissing = ignoreMissingRequested();
  const tailRows = selectedTailRows();
  const tailOptions: TailDownloadOptions = {
    overlapDays: selectedTailOverlapDays(),
    state: await readTailState(selectedTailSinceStatePath()),
    tailBytes: selectedTailBytes(),
    tailRows
  };
  if (exactPaths.length) {
    let downloadedCount = 0;
    let missingCount = 0;

    for (const relativePath of exactPaths) {
      const storageName = storageObjectPath(relativePath);
      try {
        if (tailRows > 0 && relativePath.match(/^data\/[^/]+\/[^/]+\.csv$/)) {
          await downloadCsvTailFile(storageName, relativePath, tailOptions);
        } else {
          await downloadFile(storageName, relativePath);
          console.log(`downloaded ${storageName} -> ${relativePath}`);
        }
        downloadedCount += 1;
      } catch (error) {
        if (!ignoreMissing) throw error;
        missingCount += 1;
        console.log(`missing ${storageName}`);
      }
    }

    console.log(`downloaded files ${downloadedCount}`);
    if (missingCount) console.log(`missing files ${missingCount}`);
    return;
  }

  const roots = selectedPullRoots();
  const pathPrefixes = selectedPathPrefixes();
  let downloadedCount = 0;

  for (const root of roots) {
    const [files] = await firebaseBucket().getFiles({ prefix: storageObjectPath(root.root) });
    for (const file of files) {
      const relativePath = relativePathFromStorageName(file.name);
      if (!relativePath) continue;
      if (!root.include(relativePath)) continue;
      if (pathPrefixes.length && !pathPrefixes.some((prefix) => relativePath.startsWith(prefix))) continue;

      await downloadFile(file.name, relativePath);
      downloadedCount += 1;
      console.log(`downloaded ${file.name} -> ${relativePath}`);
    }
  }

  console.log(`downloaded files ${downloadedCount}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
