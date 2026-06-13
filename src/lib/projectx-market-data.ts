import { assetLookupSymbolForSymbol, type AssetDefinition } from "@/lib/assets";
import {
  getStoredProjectXConnections,
  markStoredProjectXConnectionExpired,
  saveStoredProjectXConnection,
  type StoredProjectXConnection
} from "@/lib/projectx-connections";
import {
  listProjectXAvailableContracts,
  readableProjectXError,
  retrieveProjectXBars,
  searchProjectXContracts,
  validateProjectXSession,
  ProjectXApiError,
  type ProjectXContract,
  type ProjectXHistoryBar,
  type ProjectXHistoryUnit
} from "@/lib/projectx";

export type ProjectXMarketDataBar = {
  close: number;
  high: number;
  low: number;
  open: number;
  time: number;
  volume: number;
};

export type ProjectXMarketDataFetchOptions = {
  endSeconds: number;
  includePartialBar?: boolean;
  limit?: number;
  live?: boolean;
  startSeconds: number;
  unit: ProjectXHistoryUnit;
  unitNumber: number;
};

type ProjectXMarketDataContext = {
  connection: StoredProjectXConnection;
  contract: ProjectXContract;
  token: string;
};

type ProjectXMarketDataContextCacheEntry = {
  contexts: ProjectXMarketDataContext[];
  createdAt: number;
};

const CONTEXT_CACHE_TTL_MS = 10 * 60_000;
const contextCache = new Map<string, ProjectXMarketDataContextCacheEntry>();

const CONTRACT_SEARCH_OVERRIDES: Record<string, string> = {
  "6A": "M6A",
  "6B": "M6B",
  "6C": "6C",
  "6E": "M6E",
  "6J": "6J",
  "6M": "6M",
  "6N": "6N",
  "6S": "6S",
  CL: "MCL",
  E7: "E7",
  ES: "MES",
  GC: "MGC",
  HG: "MHG",
  HE: "HE",
  HO: "HO",
  LE: "LE",
  M2K: "M2K",
  M6A: "M6A",
  M6B: "M6B",
  M6E: "M6E",
  MBT: "MBT",
  MCL: "MCL",
  MES: "MES",
  MET: "MET",
  MGC: "MGC",
  MHG: "MHG",
  MNQ: "MNQ",
  MNG: "MNG",
  MYM: "MYM",
  NG: "MNG",
  NKD: "NKD",
  NQ: "MNQ",
  PL: "PL",
  QG: "QG",
  QM: "QM",
  RB: "RB",
  RTY: "M2K",
  SI: "SIL",
  SIL: "SIL",
  TN: "TN",
  UB: "UB",
  YM: "MYM",
  ZB: "ZB",
  ZC: "ZC",
  ZF: "ZF",
  ZL: "ZL",
  ZM: "ZM",
  ZN: "ZN",
  ZS: "ZS",
  ZT: "ZT",
  ZW: "ZW"
};

const UNIT_SECONDS: Partial<Record<ProjectXHistoryUnit, number>> = {
  1: 1,
  2: 60,
  3: 60 * 60,
  4: 24 * 60 * 60,
  5: 7 * 24 * 60 * 60
};

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function projectXMarketDataLiveFlag(): boolean {
  return envFlag("PROJECTX_MARKET_DATA_LIVE", envFlag("PROJECTX_CONTRACT_LIVE", false));
}

function parseContractOverrides(): Record<string, string> {
  const raw = process.env.PROJECTX_CONTRACT_SEARCH_OVERRIDES?.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([symbol, searchText]) => [symbol.trim().toUpperCase(), typeof searchText === "string" ? searchText.trim().toUpperCase() : ""])
        .filter(([, searchText]) => Boolean(searchText))
    );
  } catch {
    return Object.fromEntries(
      raw
        .split(",")
        .map((entry) => entry.split(":"))
        .map(([symbol, searchText]) => [symbol?.trim().toUpperCase() ?? "", searchText?.trim().toUpperCase() ?? ""])
        .filter(([symbol, searchText]) => Boolean(symbol && searchText))
    );
  }
}

function uniqueSearchTexts(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function projectXContractSearchTexts(asset: AssetDefinition): string[] {
  const overrides = parseContractOverrides();
  const symbol = asset.symbol.trim().toUpperCase();
  const sizeRoot = asset.sizeLabel.match(/^\s*\d+(?:\.\d+)?\s+([A-Z][A-Z0-9]{1,4})\b/)?.[1];
  const usableSizeRoot = sizeRoot && !["CONTRACT", "FUTURE", "FX", "MICRO", "MINI"].includes(sizeRoot) ? sizeRoot : undefined;

  return uniqueSearchTexts([
    overrides[symbol],
    CONTRACT_SEARCH_OVERRIDES[symbol],
    usableSizeRoot,
    usableSizeRoot ? overrides[usableSizeRoot] : undefined,
    usableSizeRoot ? CONTRACT_SEARCH_OVERRIDES[usableSizeRoot] : undefined,
    assetLookupSymbolForSymbol(symbol),
    symbol
  ]);
}

function contractScore(contract: ProjectXContract, searchText: string): number {
  const normalizedSearch = searchText.trim().toUpperCase();
  const id = contract.id.toUpperCase();
  const name = contract.name.toUpperCase();
  const symbolId = contract.symbolId?.toUpperCase() ?? "";
  let score = contract.activeContract ? 100 : 0;

  if (name.startsWith(normalizedSearch)) score += 40;
  if (symbolId.endsWith(`.${normalizedSearch}`) || symbolId === normalizedSearch) score += 35;
  if (id.includes(`.${normalizedSearch}.`)) score += 30;
  if (name.includes(normalizedSearch)) score += 10;
  return score;
}

function bestContract(contracts: ProjectXContract[], searchText: string): ProjectXContract | null {
  return [...contracts].sort((left, right) => contractScore(right, searchText) - contractScore(left, searchText))[0] ?? null;
}

function preferredConnectionIds(): string[] {
  return [
    process.env.PROJECTX_MARKET_DATA_CONNECTION_ID?.trim(),
    process.env.PROJECTX_AUTO_TRADE_CONNECTION_ID?.trim()
  ].filter((value): value is string => Boolean(value));
}

function orderConnections(connections: StoredProjectXConnection[]): StoredProjectXConnection[] {
  const preferredIds = preferredConnectionIds();
  if (!preferredIds.length) return connections;
  return [...connections].sort((left, right) => {
    const leftIndex = preferredIds.indexOf(left.id);
    const rightIndex = preferredIds.indexOf(right.id);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return 0;
  });
}

function contextCacheKey(asset: AssetDefinition, live: boolean): string {
  return `${asset.key}|${live ? "live" : "sim"}|${preferredConnectionIds().join(",")}`;
}

async function refreshConnection(connection: StoredProjectXConnection): Promise<StoredProjectXConnection> {
  let activeToken = connection.token;
  const refreshedToken = await validateProjectXSession(connection.token);
  activeToken = refreshedToken ?? connection.token;

  if (activeToken === connection.token) return connection;

  return saveStoredProjectXConnection({
    accessCodeHash: connection.accessCodeHash,
    accounts: connection.accounts,
    autoTradePaused: connection.autoTradePaused,
    connectedAt: connection.connectedAt,
    displayName: connection.displayName,
    id: connection.id,
    pausedAccountIds: connection.pausedAccountIds,
    removedAccountIds: connection.removedAccountIds,
    status: connection.status,
    token: activeToken,
    userName: connection.userName
  });
}

async function resolveProjectXContract(token: string, asset: AssetDefinition, live: boolean): Promise<ProjectXContract> {
  const searchTexts = projectXContractSearchTexts(asset);
  const errors: string[] = [];

  for (const searchText of searchTexts) {
    try {
      const contract = bestContract(await searchProjectXContracts(token, searchText, live), searchText);
      if (contract) return contract;
    } catch (error) {
      errors.push(`${searchText}: ${readableProjectXError(error)}`);
    }
  }

  try {
    const availableContracts = await listProjectXAvailableContracts(token, live);
    const fallback = searchTexts
      .map((searchText) => ({ contract: bestContract(availableContracts, searchText), searchText }))
      .filter((entry): entry is { contract: ProjectXContract; searchText: string } => Boolean(entry.contract))
      .sort((left, right) => contractScore(right.contract, right.searchText) - contractScore(left.contract, left.searchText))[0];
    if (fallback) return fallback.contract;
  } catch (error) {
    errors.push(`available-contract fallback: ${readableProjectXError(error)}`);
  }

  throw new Error(`No ProjectX contract found for ${asset.symbol}. Searches: ${searchTexts.join(", ")}${errors.length ? `; ${errors.join("; ")}` : ""}`);
}

async function projectXMarketDataContexts(asset: AssetDefinition, live: boolean): Promise<ProjectXMarketDataContext[]> {
  const cacheKey = contextCacheKey(asset, live);
  const cached = contextCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CONTEXT_CACHE_TTL_MS) return cached.contexts;

  const connections = orderConnections(await getStoredProjectXConnections());
  if (!connections.length) {
    throw new Error("No connected ProjectX account folder is available for futures market data.");
  }

  const contexts: ProjectXMarketDataContext[] = [];
  const errors: string[] = [];
  for (const connection of connections) {
    let refreshedConnection: StoredProjectXConnection;
    try {
      refreshedConnection = await refreshConnection(connection);
    } catch (error) {
      errors.push(`${connection.displayName ?? connection.userName ?? connection.id}: ${readableProjectXError(error)}`);
      await markStoredProjectXConnectionExpired(connection.id).catch(() => null);
      continue;
    }

    try {
      const contract = await resolveProjectXContract(refreshedConnection.token, asset, live);
      contexts.push({
        connection: refreshedConnection,
        contract,
        token: refreshedConnection.token
      });
    } catch (error) {
      errors.push(`${connection.displayName ?? connection.userName ?? connection.id}: ${readableProjectXError(error)}`);
    }
  }

  if (!contexts.length) {
    throw new Error(`No usable ProjectX market-data connection is available for ${asset.symbol}. ${errors.join("; ")}`);
  }

  contextCache.set(cacheKey, {
    contexts,
    createdAt: Date.now()
  });
  return contexts;
}

function isProjectXAuthError(error: unknown): boolean {
  return error instanceof ProjectXApiError && (error.status === 401 || error.status === 403);
}

function secondsFromProjectXTime(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function numberFromProjectXValue(value: number | string | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function normalizeProjectXBar(bar: ProjectXHistoryBar): ProjectXMarketDataBar | null {
  const time = secondsFromProjectXTime(bar.t ?? bar.time);
  if (time === null) return null;

  const normalized = {
    close: numberFromProjectXValue(bar.c ?? bar.close),
    high: numberFromProjectXValue(bar.h ?? bar.high),
    low: numberFromProjectXValue(bar.l ?? bar.low),
    open: numberFromProjectXValue(bar.o ?? bar.open),
    time,
    volume: numberFromProjectXValue(bar.v ?? bar.volume)
  };

  if (![normalized.close, normalized.high, normalized.low, normalized.open].every(Number.isFinite)) return null;
  if (!Number.isFinite(normalized.volume)) normalized.volume = 0;
  return normalized;
}

function sortedUniqueBars(bars: ProjectXMarketDataBar[]): ProjectXMarketDataBar[] {
  const byTime = new Map<number, ProjectXMarketDataBar>();
  for (const bar of bars) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

function unitSeconds(unit: ProjectXHistoryUnit, unitNumber: number): number | undefined {
  const base = UNIT_SECONDS[unit];
  if (!base || unitNumber <= 0) return undefined;
  return base * unitNumber;
}

function chunkedRanges(startSeconds: number, endSeconds: number, unit: ProjectXHistoryUnit, unitNumber: number, limit: number): Array<[number, number]> {
  const seconds = unitSeconds(unit, unitNumber);
  if (!seconds || startSeconds >= endSeconds) return [[startSeconds, endSeconds]];

  const ranges: Array<[number, number]> = [];
  const maxSpanSeconds = Math.max(seconds, Math.floor(limit * seconds * 0.95));
  let cursor = startSeconds;
  while (cursor <= endSeconds) {
    const chunkEnd = Math.min(endSeconds, cursor + maxSpanSeconds);
    ranges.push([cursor, chunkEnd]);
    if (chunkEnd >= endSeconds) break;
    cursor = chunkEnd + seconds;
  }
  return ranges;
}

export async function fetchProjectXMarketDataBars(asset: AssetDefinition, options: ProjectXMarketDataFetchOptions): Promise<ProjectXMarketDataBar[]> {
  const live = options.live ?? projectXMarketDataLiveFlag();
  const cacheKey = contextCacheKey(asset, live);
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? 20_000)), 20_000);
  const contexts = await projectXMarketDataContexts(asset, live);
  const ranges = chunkedRanges(options.startSeconds, options.endSeconds, options.unit, options.unitNumber, limit);
  const failures: string[] = [];

  for (const context of contexts) {
    try {
      const bars: ProjectXMarketDataBar[] = [];
      for (const [startSeconds, endSeconds] of ranges) {
        const responseBars = await retrieveProjectXBars(context.token, {
          contractId: context.contract.id,
          endTime: new Date(endSeconds * 1000).toISOString(),
          includePartialBar: options.includePartialBar ?? false,
          limit,
          live,
          startTime: new Date(startSeconds * 1000).toISOString(),
          unit: options.unit,
          unitNumber: options.unitNumber
        });
        bars.push(
          ...responseBars
            .map(normalizeProjectXBar)
            .filter((bar): bar is ProjectXMarketDataBar => Boolean(bar))
        );
      }
      return sortedUniqueBars(bars);
    } catch (error) {
      failures.push(`${context.connection.displayName ?? context.connection.userName ?? context.connection.id}: ${readableProjectXError(error)}`);
      if (isProjectXAuthError(error)) {
        contextCache.delete(cacheKey);
        await markStoredProjectXConnectionExpired(context.connection.id).catch(() => null);
      }
    }
  }

  throw new Error(`ProjectX market-data request failed for ${asset.symbol}: ${failures.join("; ")}`);
}
