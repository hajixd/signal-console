import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type AssetDefinition = {
  dataFile: string;
};

type StrategyMetadata = {
  assetKey?: string;
  variantId?: string;
};

type RefreshPlan = {
  backtestCsvPaths: string[];
  dataPullPaths: string[];
  generatedAt: string;
  nativeDataPaths: string[];
  sourceAssetKeys: string[];
  strategyCount: number;
};

const DERIVED_FROM_5M = new Set(["10m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"]);
const METADATA_RELATIVE_PATHS = [
  path.join("machine_learning", "selection.json"),
  path.join("bayes", "selection.json"),
  path.join("parameters", "backtest.json")
];

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function selectedField(): keyof RefreshPlan | undefined {
  const raw = process.argv.find((value) => value.startsWith("--field="));
  return raw?.slice("--field=".length) as keyof RefreshPlan | undefined;
}

function outputPath(): string | undefined {
  const raw = process.argv.find((value) => value.startsWith("--out="));
  return raw?.slice("--out=".length);
}

function strategyTimeframe(variantId: string | undefined): string {
  const match = variantId?.match(/(?:^|\|)tf=([^|]+)/);
  return match?.[1] || "15m";
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function strategyMetadataFiles(): Promise<string[]> {
  const strategyRoot = path.join(process.cwd(), "strategy");
  const entries = await readdir(strategyRoot, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const relativeMetadataPath of METADATA_RELATIVE_PATHS) {
      const metadataPath = path.join(strategyRoot, entry.name, relativeMetadataPath);
      if (await fileExists(metadataPath)) files.push(metadataPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function buildPlan(): Promise<RefreshPlan> {
  const assets = await readJson<Record<string, AssetDefinition>>(path.join(process.cwd(), "config", "assets.json"));
  const metadataFiles = await strategyMetadataFiles();
  const sourceAssetKeys: string[] = [];
  const nativeDataPaths: string[] = [];
  const backtestCsvPaths: string[] = [];

  for (const metadataPath of metadataFiles) {
    const metadata = await readJson<StrategyMetadata>(metadataPath);
    const assetKey = metadata.assetKey;
    const asset = assetKey ? assets[assetKey] : undefined;
    if (!assetKey || !asset) continue;

    const strategyDir = path.dirname(path.dirname(metadataPath));
    const strategyFolder = path.basename(strategyDir);
    const timeframe = strategyTimeframe(metadata.variantId);

    sourceAssetKeys.push(assetKey);
    backtestCsvPaths.push(path.posix.join("strategy", strategyFolder, "backtest_trades.csv"));

    if (!DERIVED_FROM_5M.has(timeframe)) {
      nativeDataPaths.push(path.posix.join("data", timeframe, asset.dataFile));
    }
  }

  const sourceDataPaths = uniqueSorted(
    sourceAssetKeys.map((assetKey) => path.posix.join("data", "5m", assets[assetKey]!.dataFile))
  );
  const nativePaths = uniqueSorted(nativeDataPaths);

  return {
    backtestCsvPaths: uniqueSorted(backtestCsvPaths),
    dataPullPaths: uniqueSorted([...sourceDataPaths, ...nativePaths]),
    generatedAt: new Date().toISOString(),
    nativeDataPaths: nativePaths,
    sourceAssetKeys: uniqueSorted(sourceAssetKeys),
    strategyCount: metadataFiles.length
  };
}

async function main(): Promise<void> {
  const plan = await buildPlan();
  const field = selectedField();
  const destination = outputPath();

  if (destination) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(plan, null, 2), "utf8");
  }

  if (field) {
    const value = plan[field];
    console.log(Array.isArray(value) ? value.join(",") : String(value ?? ""));
    return;
  }

  console.log(
    JSON.stringify(
      {
        backtestCsvFiles: plan.backtestCsvPaths.length,
        dataPullFiles: plan.dataPullPaths.length,
        nativeDataFiles: plan.nativeDataPaths.length,
        sourceAssets: plan.sourceAssetKeys.length,
        strategyCount: plan.strategyCount
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
