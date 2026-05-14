import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { firebaseBucket, hasFirebaseAdmin, storageObjectPath } from "../src/lib/firebase-admin";

type PullRoot = {
  include: (filePath: string) => boolean;
  root: string;
};

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

async function main(): Promise<void> {
  if (!hasFirebaseAdmin()) {
    throw new Error("Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or the split FIREBASE_* variables first.");
  }

  const exactPaths = selectedExactPaths();
  const ignoreMissing = ignoreMissingRequested();
  if (exactPaths.length) {
    let downloadedCount = 0;
    let missingCount = 0;

    for (const relativePath of exactPaths) {
      const storageName = storageObjectPath(relativePath);
      try {
        await downloadFile(storageName, relativePath);
        downloadedCount += 1;
        console.log(`downloaded ${storageName} -> ${relativePath}`);
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
