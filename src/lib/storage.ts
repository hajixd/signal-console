import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TradeAlert } from "./types";

const TRADES_KEY = "signal-console:alerts";
const LEGACY_TRADES_KEY = "trade-dashboard:alerts";
const localPath = path.join(process.cwd(), ".local", "signal-console-alerts.json");
const legacyLocalPath = path.join(process.cwd(), ".local", "trade-alerts.json");

function hasRedis(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function redisCommand<T>(command: Array<string | number>): Promise<T> {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Upstash ${response.status}: ${await response.text()}`);
  const payload = (await response.json()) as { result: T };
  return payload.result;
}

async function readLocal(): Promise<TradeAlert[]> {
  try {
    const raw = await readFile(localPath, "utf8");
    return JSON.parse(raw) as TradeAlert[];
  } catch {
    try {
      const raw = await readFile(legacyLocalPath, "utf8");
      return JSON.parse(raw) as TradeAlert[];
    } catch {
      return [];
    }
  }
}

async function writeLocal(trades: TradeAlert[]): Promise<void> {
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, JSON.stringify(trades, null, 2));
}

export async function getTrades(): Promise<TradeAlert[]> {
  if (hasRedis()) {
    let raw = await redisCommand<string[]>(["LRANGE", TRADES_KEY, 0, 499]);
    if (!raw.length) {
      raw = await redisCommand<string[]>(["LRANGE", LEGACY_TRADES_KEY, 0, 499]);
    }
    return raw.map((item) => JSON.parse(item) as TradeAlert);
  }
  return readLocal();
}

export async function hasTrade(id: string): Promise<boolean> {
  const trades = await getTrades();
  return trades.some((trade) => trade.id === id);
}

export async function saveTrade(trade: TradeAlert): Promise<void> {
  if (hasRedis()) {
    await redisCommand<number>(["LPUSH", TRADES_KEY, JSON.stringify(trade)]);
    await redisCommand<number>(["LTRIM", TRADES_KEY, 0, 499]);
    return;
  }
  const trades = await readLocal();
  await writeLocal([trade, ...trades.filter((item) => item.id !== trade.id)].slice(0, 500));
}

export function storageMode(): "upstash" | "local" {
  return hasRedis() ? "upstash" : "local";
}
