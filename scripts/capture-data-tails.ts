import { open, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assetsJson from "../config/assets.json";

const DATA_TIMEFRAMES = ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"] as const;

type AssetDefinition = {
  dataFile: string;
  symbol: string;
};

type TailState = {
  generatedAt: string;
  tails: Record<
    string,
    Record<
      string,
      {
        dataFile: string;
        lastBarAt?: string;
        lastBarTime?: number;
        symbol: string;
      }
    >
  >;
};

function outputPath(): string {
  const raw = process.argv.find((value) => value.startsWith("--out="));
  return raw?.slice("--out=".length) || ".local/data-tail-state.json";
}

async function lastCsvLine(filePath: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(filePath, "r");
    const stat = await handle.stat();
    if (!stat.size) return null;

    const chunkSize = Math.min(8192, stat.size);
    let position = stat.size;
    let bufferText = "";

    while (position > 0) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buffer = Buffer.alloc(readSize);
      await handle.read(buffer, 0, readSize, position);
      bufferText = buffer.toString("utf8") + bufferText;
      const lines = bufferText.trimEnd().split(/\r?\n/);
      if (lines.length > 1 || position === 0) {
        const last = lines.at(-1)?.trim();
        return last && !last.startsWith("time,") ? last : null;
      }
    }
  } catch {
    return null;
  } finally {
    await handle?.close();
  }

  return null;
}

async function main(): Promise<void> {
  const assets = assetsJson as Record<string, AssetDefinition>;
  const state: TailState = {
    generatedAt: new Date().toISOString(),
    tails: {}
  };

  for (const [assetKey, asset] of Object.entries(assets)) {
    state.tails[assetKey] = {};
    for (const timeframe of DATA_TIMEFRAMES) {
      const line = await lastCsvLine(path.join(process.cwd(), "data", timeframe, asset.dataFile));
      const rawTime = line?.split(",", 1)[0];
      const lastBarTime = rawTime ? Number(rawTime) : Number.NaN;
      state.tails[assetKey][timeframe] = {
        dataFile: asset.dataFile,
        lastBarAt: Number.isFinite(lastBarTime) ? new Date(lastBarTime * 1000).toISOString() : undefined,
        lastBarTime: Number.isFinite(lastBarTime) ? lastBarTime : undefined,
        symbol: asset.symbol
      };
    }
  }

  const destination = outputPath();
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(state, null, 2), "utf8");
  console.log(`captured data tails ${destination}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
