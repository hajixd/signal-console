import assetsJson from "../config/assets.json";
import { fetchProjectXMarketDataBars } from "../src/lib/projectx-market-data";
import type { Market } from "../src/lib/assets";
import type { ProjectXHistoryUnit } from "../src/lib/projectx";

type AssetDefinition = {
  dataFile: string;
  dollarPerUnit: number;
  key: string;
  market: Market;
  name: string;
  oandaSymbol?: string;
  sizeLabel: string;
  symbol: string;
  tickSize: number;
  twelveDataSymbol?: string;
  unitLabel: string;
};

type CliOptions = {
  assetKey?: string;
  end?: string;
  limit: number;
  start?: string;
  unit: ProjectXHistoryUnit;
  unitNumber: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 20_000,
    unit: 2,
    unitNumber: 1
  };

  for (const arg of argv) {
    if (arg.startsWith("--asset=")) {
      options.assetKey = arg.slice("--asset=".length).trim();
      continue;
    }
    if (arg.startsWith("--start=")) {
      options.start = arg.slice("--start=".length).trim();
      continue;
    }
    if (arg.startsWith("--end=")) {
      options.end = arg.slice("--end=".length).trim();
      continue;
    }
    if (arg.startsWith("--unit=")) {
      const unit = Number(arg.slice("--unit=".length));
      if ([1, 2, 3, 4, 5, 6].includes(unit)) options.unit = unit as ProjectXHistoryUnit;
      continue;
    }
    if (arg.startsWith("--unit-number=")) {
      const unitNumber = Number(arg.slice("--unit-number=".length));
      if (Number.isInteger(unitNumber) && unitNumber > 0) options.unitNumber = unitNumber;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const limit = Number(arg.slice("--limit=".length));
      if (Number.isInteger(limit) && limit > 0) options.limit = Math.min(limit, 20_000);
    }
  }

  return options;
}

function secondsFromIso(value: string | undefined, label: string): number {
  const parsed = Date.parse(value ?? "");
  if (!Number.isFinite(parsed)) throw new Error(`Pass a valid --${label}= ISO timestamp.`);
  return Math.floor(parsed / 1000);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.assetKey) throw new Error("Pass --asset=<asset key>.");

  const rawAsset = (assetsJson as Record<string, Omit<AssetDefinition, "key">>)[options.assetKey];
  if (!rawAsset) throw new Error(`Unknown asset key: ${options.assetKey}`);
  const asset: AssetDefinition = {
    key: options.assetKey,
    ...rawAsset
  };
  if (asset.market !== "futures") throw new Error(`${asset.key} is not a futures asset.`);

  const bars = await fetchProjectXMarketDataBars(asset, {
    endSeconds: secondsFromIso(options.end, "end"),
    limit: options.limit,
    startSeconds: secondsFromIso(options.start, "start"),
    unit: options.unit,
    unitNumber: options.unitNumber
  });

  process.stdout.write(JSON.stringify(bars));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
