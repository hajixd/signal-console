import { open, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildLocalStrategyCatalog, type StrategyCatalog, type StrategyCatalogSummary } from "../src/lib/backtest";
import { STRATEGY_DEFINITIONS } from "../src/lib/strategy-loader";

type AssetDefinition = {
  dataFile: string;
};

type ComputedThroughMarker = {
  assetKey: string;
  lastBarAt?: string;
  lastBarTime?: number;
  timeframe: string;
};

function variantText(variantId: string | undefined, key: string): string | undefined {
  const token = variantId?.split("|").find((part) => part.startsWith(`${key}=`));
  return token?.slice(key.length + 1);
}

async function lastBarTime(relativePath: string): Promise<number | undefined> {
  try {
    const handle = await open(path.join(process.cwd(), relativePath), "r");
    try {
      const info = await handle.stat();
      const length = Math.min(info.size, 64 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, Math.max(0, info.size - length));
      const lines = buffer.toString("utf8").trim().split(/\r?\n/).reverse();
      for (const line of lines) {
        if (!line || line.startsWith("time,")) continue;
        const value = Number(line.split(",", 1)[0]);
        if (Number.isFinite(value)) return Math.floor(value);
      }
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }

  return undefined;
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

function catalogSummary(catalog: StrategyCatalog): StrategyCatalogSummary {
  const latestTradeMs = latestTradeTime(catalog);
  return {
    catalogVersion: catalog.catalogVersion,
    ...(catalog.computedThroughAt ? { computedThroughAt: catalog.computedThroughAt } : {}),
    ...(catalog.computedThroughByStrategy ? { computedThroughByStrategy: catalog.computedThroughByStrategy } : {}),
    entries: catalog.entries,
    generatedAt: catalog.generatedAt,
    ...(latestTradeMs > 0 ? { latestTradeAt: new Date(latestTradeMs).toISOString() } : {}),
    stats: catalog.stats,
    tradeCount: catalog.trades.length
  };
}

async function main() {
  const assets = JSON.parse(await readFile(path.join(process.cwd(), "config", "assets.json"), "utf8")) as Record<
    string,
    AssetDefinition
  >;
  const strategyById = new Map(STRATEGY_DEFINITIONS.map((strategy) => [strategy.id, strategy]));
  const catalog = await buildLocalStrategyCatalog();
  const computedThroughByStrategy: Record<string, ComputedThroughMarker> = {};

  for (const entry of catalog.entries) {
    const strategy = strategyById.get(entry.key);
    const timeframe = variantText(strategy?.defaults?.variantId, "tf") ?? "15m";
    const dataFile = assets[entry.assetKey]?.dataFile;
    if (!dataFile) continue;

    const lastBarTimeValue = await lastBarTime(path.posix.join("data", timeframe, dataFile));
    if (typeof lastBarTimeValue !== "number" || !Number.isFinite(lastBarTimeValue)) continue;

    computedThroughByStrategy[entry.key] = {
      assetKey: entry.assetKey,
      lastBarAt: new Date(lastBarTimeValue * 1000).toISOString(),
      lastBarTime: lastBarTimeValue,
      timeframe
    };
  }

  const computedThroughTimes = Object.values(computedThroughByStrategy)
    .map((entry) => entry.lastBarTime)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const generatedAt = new Date().toISOString();
  const manifest: StrategyCatalog = {
    catalogVersion: 1,
    ...(computedThroughTimes.length
      ? { computedThroughAt: new Date(Math.min(...computedThroughTimes) * 1000).toISOString() }
      : {}),
    ...(Object.keys(computedThroughByStrategy).length ? { computedThroughByStrategy } : {}),
    generatedAt,
    ...catalog
  };
  const summary = catalogSummary(manifest);

  await mkdir(path.join(process.cwd(), "cache"), { recursive: true });
  await writeFile(path.join(process.cwd(), "cache", "backtest-manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(process.cwd(), "cache", "backtest-summary.json"), JSON.stringify(summary));

  console.log(
    JSON.stringify(
      {
        computedThroughAt: manifest.computedThroughAt,
        entries: manifest.entries.length,
        generatedAt,
        stats: manifest.stats.length,
        trades: manifest.trades.length
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
