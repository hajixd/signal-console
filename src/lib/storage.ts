import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { firebaseDb, firebaseLocalFallbackEnabled, hasFirebaseAdmin, withFirebaseTimeout } from "@/lib/firebase-admin";
import { omitUndefinedDeep } from "@/lib/firestore-utils";
import type { TradeAlert } from "./types";

const TRADE_COLLECTION = "signalConsoleAlerts";
const localPath = path.join(process.cwd(), ".local", "trading-bot-alerts.json");
const legacyLocalPath = path.join(process.cwd(), ".local", "signal-console-alerts.json");

function sortTrades(trades: TradeAlert[]): TradeAlert[] {
  return [...trades].sort((left, right) => Date.parse(right.signalTime) - Date.parse(left.signalTime));
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

function normalizeTrade(value: unknown): TradeAlert | null {
  if (!value || typeof value !== "object") return null;
  return value as TradeAlert;
}

export async function getTrades(): Promise<TradeAlert[]> {
  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(
        firebaseDb()
          .collection(TRADE_COLLECTION)
          .orderBy("signalTimeMillis", "desc")
          .limit(500)
          .get(),
        "Firebase trade history read"
      );

      return snapshot.docs
        .map((doc) => normalizeTrade(doc.data()))
        .filter((trade): trade is TradeAlert => Boolean(trade));
    } catch {
      return sortTrades(await readLocal());
    }
  }
  return sortTrades(await readLocal());
}

export async function hasTrade(id: string): Promise<boolean> {
  if (hasFirebaseAdmin()) {
    try {
      return (await withFirebaseTimeout(firebaseDb().collection(TRADE_COLLECTION).doc(id).get(), "Firebase trade lookup")).exists;
    } catch {
      const trades = await readLocal();
      return trades.some((trade) => trade.id === id);
    }
  }
  const trades = await getTrades();
  return trades.some((trade) => trade.id === id);
}

function tradePayload(trade: TradeAlert): TradeAlert & { createdAtMillis: number; signalTimeMillis: number; updatedAt: string } {
  return omitUndefinedDeep({
    ...trade,
    createdAtMillis: Date.parse(trade.createdAt) || Date.now(),
    signalTimeMillis: Date.parse(trade.signalTime) || Date.now(),
    updatedAt: new Date().toISOString()
  });
}

export async function claimTrade(trade: TradeAlert): Promise<boolean> {
  const payload = tradePayload(trade);

  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb()
          .collection(TRADE_COLLECTION)
          .doc(trade.id)
          .create(payload),
        "Firebase trade create"
      );
      return true;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code === 6 || code === "already-exists" || code === "ALREADY_EXISTS") return false;
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }

  const trades = await readLocal();
  if (trades.some((item) => item.id === trade.id)) return false;
  await writeLocal([payload, ...trades].slice(0, 500));
  return true;
}

export async function saveTrade(trade: TradeAlert): Promise<void> {
  const payload = tradePayload(trade);

  if (hasFirebaseAdmin()) {
    try {
      await withFirebaseTimeout(
        firebaseDb()
          .collection(TRADE_COLLECTION)
          .doc(trade.id)
          .set(payload),
        "Firebase trade save"
      );
      return;
    } catch (error) {
      if (!firebaseLocalFallbackEnabled()) throw error;
    }
  }
  const trades = await readLocal();
  await writeLocal([payload, ...trades.filter((item) => item.id !== trade.id)].slice(0, 500));
}

export function storageMode(): "firebase" | "local" {
  return hasFirebaseAdmin() ? "firebase" : "local";
}
