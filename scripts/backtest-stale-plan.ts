import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assetsJson from "../config/assets.json";
import { getDatasetStatus } from "../src/lib/live-config";
import { STRATEGY_DEFINITIONS } from "../src/lib/strategy-loader";

type AssetDefinition = {
  dataFile: string;
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

type BacktestManifest = {
  computedThroughByStrategy?: Record<string, { lastBarTime?: number }>;
  generatedAt?: string;
};

type StaleStrategy = {
  assetKey: string;
  backtestCsvPath: string;
  currentLastBarAt?: string;
  currentLastBarTime?: number;
  previousComputedAt?: string;
  previousComputedTime?: number;
  strategyId: string;
  timeframe: string;
};

type StalePlan = {
  generatedAt: string;
  staleBacktestCsvPaths: string[];
  staleCount: number;
  staleDataPullPaths: string[];
  staleSourceAssetKeys: string[];
  staleStrategies: StaleStrategy[];
  staleStrategyIds: string[];
  strategyCount: number;
};

const DEFAULT_DATA_TAIL_STATE_PATH = ".local/data-tail-state.json";
const DEFAULT_MANIFEST_PATH = "cache/backtest-manifest.json";
const DEFAULT_STALE_TOLERANCE_SECONDS = 60;
const DERIVED_FROM_5M = new Set(["10m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"]);

function argumentValue(name: string): string | undefined {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`));
  return raw?.slice(name.length + 3);
}

function selectedField(): keyof StalePlan | undefined {
  return argumentValue("field") as keyof StalePlan | undefined;
}

function outputPath(): string | undefined {
  return argumentValue("out");
}

function incrementalStartStateOutputPath(): string | undefined {
  return argumentValue("incremental-start-state-out");
}

function dataTailStatePath(): string {
  return argumentValue("data-tail-state") || DEFAULT_DATA_TAIL_STATE_PATH;
}

function manifestPath(): string {
  return argumentValue("manifest") || DEFAULT_MANIFEST_PATH;
}

function staleToleranceSeconds(): number {
  const configured = Number(argumentValue("stale-tolerance-seconds"));
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_STALE_TOLERANCE_SECONDS;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function strategyTimeframe(variantId: string | undefined): string {
  const match = variantId?.match(/(?:^|\|)tf=([^|]+)/);
  return match?.[1] || "15m";
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.resolve(process.cwd(), filePath), "utf8")) as T;
  } catch {
    return null;
  }
}

async function loadCurrentTailState(): Promise<DataTailState | null> {
  const fileState = await readJsonIfExists<DataTailState>(dataTailStatePath());
  if (fileState) return fileState;

  const status = await getDatasetStatus();
  if (!status?.assetCoverage) return null;

  const tails: DataTailState["tails"] = {};
  for (const [assetKey, coverage] of Object.entries(status.assetCoverage)) {
    const lastBarTime = secondsFromIso(coverage.lastBarAt);
    if (lastBarTime === undefined) continue;
    tails[assetKey] = {};
    for (const timeframe of coverage.timeframes.length ? coverage.timeframes : ["15m"]) {
      tails[assetKey]![timeframe] = {
        lastBarAt: coverage.lastBarAt,
        lastBarTime
      };
    }
  }

  return { tails };
}

function secondsFromIso(value: string | undefined): number | undefined {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
}

function isoFromSeconds(value: number | undefined): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : undefined;
}

function dataPathForStrategy(strategy: (typeof STRATEGY_DEFINITIONS)[number], timeframe: string): string {
  const assets = assetsJson as Record<string, AssetDefinition>;
  const pullTimeframe = DERIVED_FROM_5M.has(timeframe) ? "5m" : timeframe;
  return path.posix.join("data", pullTimeframe, assets[strategy.assetKey]?.dataFile ?? `${strategy.assetKey}.csv`);
}

function previousComputedTime(manifest: BacktestManifest | null, strategyId: string): number | undefined {
  const strategyTime = manifest?.computedThroughByStrategy?.[strategyId]?.lastBarTime;
  if (typeof strategyTime === "number" && Number.isFinite(strategyTime)) return strategyTime;
  return secondsFromIso(manifest?.generatedAt);
}

async function buildPlan(): Promise<StalePlan> {
  const [dataTailState, manifest] = await Promise.all([loadCurrentTailState(), readJsonIfExists<BacktestManifest>(manifestPath())]);
  const toleranceSeconds = staleToleranceSeconds();
  const staleStrategies: StaleStrategy[] = [];

  for (const strategy of STRATEGY_DEFINITIONS) {
    const timeframe = strategyTimeframe(strategy.defaults?.variantId);
    const currentTail = dataTailState?.tails?.[strategy.assetKey]?.[timeframe];
    const currentLastBarTime = currentTail?.lastBarTime;
    const previousTime = previousComputedTime(manifest, strategy.id);
    const isStale =
      typeof currentLastBarTime !== "number" ||
      !Number.isFinite(currentLastBarTime) ||
      typeof previousTime !== "number" ||
      !Number.isFinite(previousTime) ||
      currentLastBarTime - previousTime > toleranceSeconds;

    if (!isStale) continue;

    staleStrategies.push({
      assetKey: strategy.assetKey,
      backtestCsvPath: path.posix.join("strategy", strategy.folder, strategy.backtestFileName),
      currentLastBarAt: currentTail?.lastBarAt ?? isoFromSeconds(currentLastBarTime),
      currentLastBarTime,
      previousComputedAt: isoFromSeconds(previousTime),
      previousComputedTime: previousTime,
      strategyId: strategy.id,
      timeframe
    });
  }

  const staleStrategyIds = uniqueSorted(staleStrategies.map((strategy) => strategy.strategyId));

  return {
    generatedAt: new Date().toISOString(),
    staleBacktestCsvPaths: uniqueSorted(staleStrategies.map((strategy) => strategy.backtestCsvPath)),
    staleCount: staleStrategies.length,
    staleDataPullPaths: uniqueSorted(
      staleStrategies.map((strategy) => {
        const definition = STRATEGY_DEFINITIONS.find((entry) => entry.id === strategy.strategyId)!;
        return dataPathForStrategy(definition, strategy.timeframe);
      })
    ),
    staleSourceAssetKeys: uniqueSorted(staleStrategies.map((strategy) => strategy.assetKey)),
    staleStrategies: staleStrategies.sort((left, right) => left.strategyId.localeCompare(right.strategyId)),
    staleStrategyIds,
    strategyCount: STRATEGY_DEFINITIONS.length
  };
}

function buildIncrementalStartState(plan: StalePlan): DataTailState {
  const state: DataTailState = {
    tails: {}
  };

  function record(assetKey: string, timeframe: string, previousComputedTime: number) {
    state.tails![assetKey] ??= {};
    const existing = state.tails![assetKey]![timeframe]?.lastBarTime;
    const lastBarTime =
      typeof existing === "number" && Number.isFinite(existing)
        ? Math.min(existing, previousComputedTime)
        : previousComputedTime;
    state.tails![assetKey]![timeframe] = {
      lastBarTime
    };
  }

  for (const strategy of plan.staleStrategies) {
    if (typeof strategy.previousComputedTime !== "number" || !Number.isFinite(strategy.previousComputedTime)) continue;
    record(strategy.assetKey, strategy.timeframe, strategy.previousComputedTime);
    if (DERIVED_FROM_5M.has(strategy.timeframe)) {
      record(strategy.assetKey, "5m", strategy.previousComputedTime);
    }
  }

  return state;
}

async function main(): Promise<void> {
  const plan = await buildPlan();
  const field = selectedField();
  const destination = outputPath();
  const incrementalStateDestination = incrementalStartStateOutputPath();

  if (destination) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(plan, null, 2), "utf8");
  }

  if (incrementalStateDestination) {
    await mkdir(path.dirname(incrementalStateDestination), { recursive: true });
    await writeFile(incrementalStateDestination, JSON.stringify(buildIncrementalStartState(plan), null, 2), "utf8");
  }

  if (field) {
    const value = plan[field];
    console.log(Array.isArray(value) ? value.join(",") : String(value ?? ""));
    return;
  }

  console.log(
    JSON.stringify(
      {
        staleBacktestCsvFiles: plan.staleBacktestCsvPaths.length,
        staleDataPullFiles: plan.staleDataPullPaths.length,
        staleStrategies: plan.staleCount,
        staleSourceAssets: plan.staleSourceAssetKeys.length,
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
