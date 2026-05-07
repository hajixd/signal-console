import { NextResponse } from "next/server";
import { assetForSymbol, isMarket } from "@/lib/assets";
import { readDataText } from "@/lib/project-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MarketBar = {
  index: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

const lineCache = new Map<string, string[]>();
const SUPPORTED_TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"]);
const DEFAULT_TIMEFRAME = "15m";
const DEFAULT_CONTEXT_CANDLES = 80;

function chartTimeframe(value: string | null): string {
  return value && SUPPORTED_TIMEFRAMES.has(value) ? value : DEFAULT_TIMEFRAME;
}

function contextCandles(value: string | null): number {
  return Math.max(8, Math.min(DEFAULT_CONTEXT_CANDLES, Math.round(numericParam(value, DEFAULT_CONTEXT_CANDLES))));
}

function marketDataPath(symbolValue: string, marketValue: string, timeframe: string): string | null {
  const asset = assetForSymbol(symbolValue);
  const market = marketValue.trim().toLowerCase();
  if (!asset) return null;
  if (market && isMarket(market) && market !== asset.market) return null;
  return `${timeframe}/${asset.dataFile}`;
}

async function marketLines(relativePath: string): Promise<string[]> {
  const cached = lineCache.get(relativePath);
  if (cached) return cached;
  const text = await readDataText(relativePath);
  const lines = text.trim().split(/\r?\n/);
  lineCache.set(relativePath, lines);
  return lines;
}

function numericParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBar(line: string, index: number): MarketBar | null {
  const [timeValue, openValue, highValue, lowValue, closeValue, volumeValue] = line.split(",");
  const timestamp = Number(timeValue);
  const open = Number(openValue);
  const high = Number(highValue);
  const low = Number(lowValue);
  const close = Number(closeValue);
  if (![timestamp, open, high, low, close].every(Number.isFinite)) return null;
  const volume = Number(volumeValue);
  return {
    index,
    time: new Date(timestamp * 1000).toISOString(),
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : undefined
  };
}

function timestampForLine(line: string | undefined): number | null {
  if (!line) return null;
  const timestamp = Number(line.split(",", 1)[0]);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function indexAtOrBefore(lines: string[], targetSeconds: number): number | null {
  const lastIndex = lines.length - 2;
  if (lastIndex < 0 || !Number.isFinite(targetSeconds)) return null;

  let left = 0;
  let right = lastIndex;
  let best: number | null = null;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const timestamp = timestampForLine(lines[middle + 1]);
    if (timestamp == null) break;

    if (timestamp <= targetSeconds) {
      best = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  return best;
}

function nearestIndexForTime(lines: string[], rawTime: string | null, fallbackIndex: number): number {
  const parsed = rawTime ? Date.parse(rawTime) : NaN;
  if (!Number.isFinite(parsed)) return fallbackIndex;

  const lastIndex = Math.max(0, lines.length - 2);
  const targetSeconds = Math.floor(parsed / 1000);
  const before = indexAtOrBefore(lines, targetSeconds);
  if (before == null) return fallbackIndex;

  const candidates = [before, Math.min(lastIndex, before + 1)];
  let bestIndex = before;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const timestamp = timestampForLine(lines[candidate + 1]);
    if (timestamp == null) continue;
    const distance = Math.abs(timestamp - targetSeconds);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = candidate;
    }
  }

  return bestIndex;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") ?? "";
  const market = searchParams.get("market") ?? "";
  const entryIndex = Math.max(0, Math.round(numericParam(searchParams.get("entryIndex"), 0)));
  const exitIndex = Math.max(0, Math.round(numericParam(searchParams.get("exitIndex"), entryIndex)));
  const context = contextCandles(searchParams.get("context"));
  const timeframe = chartTimeframe(searchParams.get("timeframe"));
  const filePath = marketDataPath(symbol, market, timeframe);

  if (!filePath) {
    return NextResponse.json({ bars: [], error: "Missing symbol" }, { status: 400 });
  }

  try {
    const lines = await marketLines(filePath);
    const lastIndex = Math.max(0, lines.length - 2);
    const resolvedEntryIndex = nearestIndexForTime(lines, searchParams.get("entryTime"), entryIndex);
    const resolvedExitIndex = nearestIndexForTime(lines, searchParams.get("exitTime"), exitIndex);
    const tradeStart = Math.min(resolvedEntryIndex, resolvedExitIndex);
    const tradeEnd = Math.max(resolvedEntryIndex, resolvedExitIndex);
    const startIndex = Math.max(0, tradeStart - context);
    const endIndex = Math.min(lastIndex, tradeEnd + context);
    const bars: MarketBar[] = [];

    for (let index = startIndex; index <= endIndex; index += 1) {
      const bar = parseBar(lines[index + 1] ?? "", index);
      if (bar) bars.push(bar);
    }

    return NextResponse.json({ bars });
  } catch {
    return NextResponse.json({ bars: [], error: "Chart data unavailable" }, { status: 404 });
  }
}
