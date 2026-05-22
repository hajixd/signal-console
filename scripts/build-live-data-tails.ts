import { mkdir, open, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

type CachedBar = [string, number, number, number, number, number?];

const DEFAULT_BAR_LIMIT = 1500;
const MIN_TAIL_BYTES = 512 * 1024;

function barLimit(): number {
  const raw = process.argv.find((value) => value.startsWith("--limit="))?.slice("--limit=".length);
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BAR_LIMIT;
}

async function readTail(filePath: string, byteCount: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat();
    const size = Math.min(byteCount, stat.size);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, Math.max(0, stat.size - size));
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

function parseLine(line: string): CachedBar | null {
  const [timeValue, openValue, highValue, lowValue, closeValue, volumeValue] = line.trim().split(",");
  const timestamp = Number(timeValue);
  const open = Number(openValue);
  const high = Number(highValue);
  const low = Number(lowValue);
  const close = Number(closeValue);
  const volume = Number(volumeValue ?? 0);
  if (![timestamp, open, high, low, close].every(Number.isFinite)) return null;
  return [new Date(timestamp * 1000).toISOString(), open, high, low, close, Number.isFinite(volume) ? volume : 0];
}

async function main(): Promise<void> {
  const limit = barLimit();
  const sourceTimeframe = "5m";
  const sourceDir = path.join(process.cwd(), "data", sourceTimeframe);
  const outputPath = path.join(process.cwd(), "cache", "live-data-tails.json");
  const files = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".csv"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const cache: { barLimit: number; files: Record<string, CachedBar[]>; generatedAt: string } = {
    barLimit: limit,
    files: {},
    generatedAt: new Date().toISOString()
  };

  for (const fileName of files) {
    const text = await readTail(path.join(sourceDir, fileName), Math.max(MIN_TAIL_BYTES, limit * 128));
    cache.files[`${sourceTimeframe}/${fileName}`] = text
      .split(/\r?\n/)
      .map((line) => (line.startsWith("time,") ? null : parseLine(line)))
      .filter((bar): bar is CachedBar => Boolean(bar))
      .slice(-limit);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cache));
  console.log(
    JSON.stringify({
      files: Object.keys(cache.files).length,
      outputPath,
      rows: Object.values(cache.files).reduce((sum, rows) => sum + rows.length, 0)
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
