import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { firebaseDb, firebaseLocalFallbackEnabled, hasFirebaseAdmin, withFirebaseTimeout } from "@/lib/firebase-admin";
import { omitUndefinedDeep } from "@/lib/firestore-utils";
import { createTursoDocument, getTursoDocument, listTursoDocuments, saveTursoDocument, tursoConfigured } from "@/lib/turso";
import type { TradeAlert } from "./types";

const TRADE_COLLECTION = "signalConsoleAlerts";
const MAX_STORED_TRADES = 5000;
const localPath = path.join(process.cwd(), ".local", "trading-bot-alerts.json");
const legacyLocalPath = path.join(process.cwd(), ".local", "signal-console-alerts.json");

function sortTrades(trades: TradeAlert[]): TradeAlert[] {
  return [...trades].sort((left, right) => Date.parse(right.signalTime) - Date.parse(left.signalTime));
}

function dedupeSortedTrades(trades: TradeAlert[]): TradeAlert[] {
  const byId = new Map<string, TradeAlert>();
  for (const trade of sortTrades(trades)) {
    if (!byId.has(trade.id)) byId.set(trade.id, trade);
  }
  return [...byId.values()].slice(0, MAX_STORED_TRADES);
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

function normalizeTrade(value: unknown, fallbackId?: string): TradeAlert | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<TradeAlert> & { id?: unknown };
  const id = typeof record.id === "string" && record.id.trim() ? record.id : fallbackId;
  if (!id || typeof record.signalTime !== "string" || !record.signalTime.trim()) return null;
  return {
    ...record,
    id
  } as TradeAlert;
}

async function getFirestoreTrades(): Promise<TradeAlert[]> {
  const collection = firebaseDb().collection(TRADE_COLLECTION);
  const trades: TradeAlert[] = [];

  try {
    const snapshot = await withFirebaseTimeout(
      collection.orderBy("signalTimeMillis", "desc").limit(MAX_STORED_TRADES).get(),
      "Firebase trade history read by signalTimeMillis"
    );
    trades.push(
      ...snapshot.docs
        .map((doc) => normalizeTrade(doc.data(), doc.id))
        .filter((trade): trade is TradeAlert => Boolean(trade))
    );
  } catch {
    // Older collections may not have signalTimeMillis on every alert.
  }

  try {
    const snapshot = await withFirebaseTimeout(
      collection.orderBy("signalTime", "desc").limit(MAX_STORED_TRADES).get(),
      "Firebase trade history read by signalTime"
    );
    trades.push(
      ...snapshot.docs
        .map((doc) => normalizeTrade(doc.data(), doc.id))
        .filter((trade): trade is TradeAlert => Boolean(trade))
    );
  } catch {
    // Fall back to an unordered collection read below if both ordered reads fail.
  }

  if (!trades.length) {
    const snapshot = await withFirebaseTimeout(
      collection.limit(MAX_STORED_TRADES).get(),
      "Firebase trade history read"
    );
    trades.push(
      ...snapshot.docs
        .map((doc) => normalizeTrade(doc.data(), doc.id))
        .filter((trade): trade is TradeAlert => Boolean(trade))
    );
  }

  return dedupeSortedTrades(trades);
}

export async function getTrades(): Promise<TradeAlert[]> {
  if (tursoConfigured()) {
    try {
      return dedupeSortedTrades(
        (await listTursoDocuments(TRADE_COLLECTION, MAX_STORED_TRADES))
          .map((doc) => normalizeTrade({ ...doc.payload, id: doc.payload.id ?? doc.id }, doc.id))
          .filter((trade): trade is TradeAlert => Boolean(trade))
      );
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      return await getFirestoreTrades();
    } catch {
      return dedupeSortedTrades(await readLocal());
    }
  }
  return dedupeSortedTrades(await readLocal());
}

export async function getTrade(id: string): Promise<TradeAlert | null> {
  if (tursoConfigured()) {
    try {
      const doc = await getTursoDocument(TRADE_COLLECTION, id);
      return doc ? normalizeTrade({ ...doc.payload, id: doc.payload.id ?? doc.id }, doc.id) : null;
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

  if (hasFirebaseAdmin()) {
    try {
      const snapshot = await withFirebaseTimeout(firebaseDb().collection(TRADE_COLLECTION).doc(id).get(), "Firebase trade get");
      return snapshot.exists ? normalizeTrade(snapshot.data(), id) : null;
    } catch {
      return (await readLocal()).find((trade) => trade.id === id) ?? null;
    }
  }

  return (await readLocal()).find((trade) => trade.id === id) ?? null;
}

export async function hasTrade(id: string): Promise<boolean> {
  if (tursoConfigured()) {
    try {
      return Boolean(await getTursoDocument(TRADE_COLLECTION, id));
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

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

  if (tursoConfigured()) {
    try {
      return createTursoDocument({
        collection: TRADE_COLLECTION,
        id: trade.id,
        payload,
        sortTimeMillis: Date.parse(trade.signalTime) || Date.now()
      });
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

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
  await writeLocal(dedupeSortedTrades([payload, ...trades]));
  return true;
}

export async function saveTrade(trade: TradeAlert): Promise<void> {
  const payload = tradePayload(trade);

  if (tursoConfigured()) {
    try {
      await saveTursoDocument({
        collection: TRADE_COLLECTION,
        id: trade.id,
        payload,
        sortTimeMillis: Date.parse(trade.signalTime) || Date.now()
      });
      return;
    } catch {
      // Fall back to Firebase/local storage below.
    }
  }

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
  await writeLocal(dedupeSortedTrades([payload, ...trades.filter((item) => item.id !== trade.id)]));
}

export function storageMode(): "firebase" | "local" | "turso" {
  if (tursoConfigured()) return "turso";
  return hasFirebaseAdmin() ? "firebase" : "local";
}
