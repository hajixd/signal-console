import assetsJson from "@config/assets.json";

export type Market = "futures" | "forex" | "gold_spot" | "crypto";

export type AssetDefinition = {
  key: string;
  symbol: string;
  name: string;
  market: Market;
  dataFile: string;
  tickSize: number;
  dollarPerUnit: number;
  sizeLabel: string;
  unitLabel: string;
  databentoSymbol?: string;
  twelveDataSymbol?: string;
  oandaSymbol?: string;
};

const ASSET_ENTRIES = Object.entries(assetsJson as Record<string, Omit<AssetDefinition, "key">>).map(([key, asset]) => ({
  key,
  ...asset
})) satisfies AssetDefinition[];

export const ASSET_LIST = [...ASSET_ENTRIES].sort((left, right) => left.name.localeCompare(right.name, "en-US", { sensitivity: "base" }));
export const ASSET_KEYS = ASSET_LIST.map((asset) => asset.key);
export const DATA_TIMEFRAMES = ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d", "1w"] as const;
export type DataTimeframe = (typeof DATA_TIMEFRAMES)[number];

const ASSET_BY_KEY = new Map(ASSET_LIST.map((asset) => [asset.key, asset]));
const ASSET_BY_SYMBOL = new Map(ASSET_LIST.map((asset) => [asset.symbol, asset]));
const FUTURES_LOOKUP_SYMBOL_BY_SYMBOL: Record<string, string> = {
  "6A": "M6A",
  "6B": "M6B",
  "6C": "6C",
  "6E": "E7",
  "6J": "6J",
  "6M": "6M",
  "6N": "6N",
  "6S": "M7",
  CL: "MCL",
  ES: "MES",
  GC: "MGC",
  HG: "MHG",
  MBT: "MBT",
  MET: "MET",
  NG: "QG",
  NQ: "MNQ",
  RTY: "M2K",
  SI: "SIL",
  YM: "MYM"
};

export function assetForKey(key: string): AssetDefinition {
  const asset = ASSET_BY_KEY.get(key);
  if (!asset) {
    throw new Error(`Unknown asset key: ${key}`);
  }
  return asset;
}

export function assetForSymbol(symbol: string): AssetDefinition | undefined {
  return ASSET_BY_SYMBOL.get(symbol.trim().toUpperCase());
}

export function assetLookupSymbolForSymbol(symbol: string): string {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) return "--";
  const asset = assetForSymbol(normalizedSymbol);
  if (!asset) return normalizedSymbol;
  if (asset.market === "futures") return FUTURES_LOOKUP_SYMBOL_BY_SYMBOL[asset.symbol] ?? asset.symbol;
  return asset.oandaSymbol ?? asset.twelveDataSymbol ?? asset.symbol;
}

export function assetDisplayNameForSymbol(symbol: string): string {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) return "--";
  const asset = assetForSymbol(normalizedSymbol);
  if (!asset) return normalizedSymbol;
  const lookupSymbol = assetLookupSymbolForSymbol(normalizedSymbol);
  return lookupSymbol === asset.name ? asset.name : `${lookupSymbol} - ${asset.name}`;
}

export function defaultTickSize(symbol: string, market?: Market): number {
  const asset = assetForSymbol(symbol);
  if (asset) return asset.tickSize;
  return market === "gold_spot" || market === "crypto" ? 0.01 : 0.0001;
}

export function isMarket(value: string | undefined): value is Market {
  return value === "futures" || value === "forex" || value === "gold_spot" || value === "crypto";
}
