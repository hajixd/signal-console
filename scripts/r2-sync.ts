import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { r2Configured, r2HeadObject, r2PutObject } from "../src/lib/r2";

type UploadRoot = {
  include: (filePath: string) => boolean;
  root: string;
};

const UPLOAD_ROOTS: UploadRoot[] = [
  {
    root: "cache",
    include: (filePath) => [".csv", ".json"].includes(path.extname(filePath).toLowerCase())
  },
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
  },
  {
    root: "Research",
    include: (filePath) => [".csv", ".json", ".md"].includes(path.extname(filePath).toLowerCase())
  }
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim();
}

function changedOnlyRequested(): boolean {
  return process.argv.includes("--changed-only");
}

function selectedUploadRoots(): UploadRoot[] {
  const raw = argValue("roots");
  if (!raw) return UPLOAD_ROOTS.filter((entry) => entry.root !== "Research");

  const selectedNames = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!selectedNames.length) {
    throw new Error("The --roots argument must include at least one of: cache, config, data, strategy, Research.");
  }

  return unique(
    selectedNames.map((name) => {
      const match = UPLOAD_ROOTS.find((entry) => entry.root === name);
      if (!match) throw new Error(`Unknown root "${name}". Expected one of: cache, config, data, strategy, Research.`);
      return match;
    })
  );
}

function selectedPathPrefixes(): string[] {
  const raw = argValue("path-prefixes");
  if (!raw) return [];
  return unique(
    raw
      .split(",")
      .map((value) => value.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, ""))
      .filter(Boolean)
  );
}

function selectedExactPaths(): string[] {
  const raw = argValue("paths");
  if (!raw) return [];
  return unique(
    raw
      .split(",")
      .map((value) => value.trim().replace(/\\/g, "/").replace(/^\/+/, ""))
      .filter(Boolean)
  );
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") return "text/csv; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
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
      if (include(relativePath)) results.push(relativePath);
    }
  }

  await visit(absoluteRoot);
  return results.sort((left, right) => left.localeCompare(right));
}

async function uploadPath(relativePath: string): Promise<"skipped" | "uploaded"> {
  const absolutePath = path.join(process.cwd(), relativePath);
  const info = await stat(absolutePath);

  if (changedOnlyRequested()) {
    const remote = await r2HeadObject(relativePath);
    if (remote?.contentLength === info.size) return "skipped";
  }

  await r2PutObject(relativePath, createReadStream(absolutePath), {
    contentLength: info.size,
    contentType: contentType(relativePath)
  });
  return "uploaded";
}

async function main(): Promise<void> {
  if (!r2Configured()) {
    throw new Error("R2 is not configured. Set R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY first.");
  }

  const exactPaths = selectedExactPaths();
  const roots = selectedUploadRoots();
  const prefixes = selectedPathPrefixes();
  const files = exactPaths.length
    ? exactPaths
    : unique((await Promise.all(roots.map((entry) => walk(entry.root, entry.include)))).flat());
  const selectedFiles = prefixes.length ? files.filter((file) => prefixes.some((prefix) => file.startsWith(prefix))) : files;

  let uploaded = 0;
  let skipped = 0;
  for (const file of selectedFiles) {
    const result = await uploadPath(file);
    if (result === "uploaded") {
      uploaded += 1;
      console.log(`uploaded ${file}`);
    } else {
      skipped += 1;
    }
  }

  console.log(`R2 sync complete: ${uploaded} uploaded, ${skipped} skipped`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
