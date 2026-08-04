import { assetForKey } from "@/lib/assets";
import { fetchStoredAssetBars } from "@/lib/market-data-store";
import type { AutoTradeMarket, AutoTradeProviderId } from "@/lib/auto-trade-platforms";
import type { Side, TradeAlert } from "@/lib/types";

const DEFAULT_TEST_ASSET_BY_MARKET: Record<AutoTradeMarket, string> = {
  forex: "eur_usd",
  futures: "sp_500_futures"
};

const DEFAULT_TEST_PRICE_BY_MARKET: Record<AutoTradeMarket, number> = {
  forex: 1.1,
  futures: 5000
};

const DEFAULT_TEST_SIZE_BY_MARKET: Record<AutoTradeMarket, number> = {
  forex: 0.01,
  futures: 1
};

const DEFAULT_TEST_UNITS_BY_MARKET: Record<AutoTradeMarket, number> = {
  forex: 10,
  futures: 6
};

function envText(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function envNumber(name: string): number | undefined {
  const value = Number(envText(name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function marketEnvName(market: AutoTradeMarket, suffix: string): string {
  return `AUTO_TRADE_TEST_${market.toUpperCase()}_${suffix}`;
}

function testSide(market: AutoTradeMarket): Side {
  const value = (envText(marketEnvName(market, "SIDE")) ?? envText("AUTO_TRADE_TEST_SIDE"))?.toLowerCase();
  return value === "short" ? "short" : "long";
}

async function latestStoredClose(assetKey: string): Promise<number | undefined> {
  try {
    const bars = await fetchStoredAssetBars(assetKey, 260);
    const close = bars.at(-1)?.close;
    return typeof close === "number" && Number.isFinite(close) && close > 0 ? close : undefined;
  } catch {
    return undefined;
  }
}

function roundToTick(value: number, tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return value;
  return Number((Math.round(value / tickSize) * tickSize).toPrecision(12));
}

export async function buildAutoTradeTestTrade(
  market: AutoTradeMarket,
  providerId: AutoTradeProviderId,
  accountId?: number | string,
  options: { useStoredPrice?: boolean } = {}
): Promise<TradeAlert> {
  const assetKey = envText(marketEnvName(market, "ASSET_KEY")) ?? DEFAULT_TEST_ASSET_BY_MARKET[market];
  const asset = assetForKey(assetKey);
  const entryPrice =
    envNumber(marketEnvName(market, "ENTRY_PRICE")) ??
    envNumber("AUTO_TRADE_TEST_ENTRY_PRICE") ??
    (options.useStoredPrice === false ? undefined : await latestStoredClose(assetKey)) ??
    DEFAULT_TEST_PRICE_BY_MARKET[market];
  const side = testSide(market);
  const direction = side === "long" ? 1 : -1;
  const slUnits = envNumber(marketEnvName(market, "SL_UNITS")) ?? envNumber("AUTO_TRADE_TEST_SL_UNITS") ?? DEFAULT_TEST_UNITS_BY_MARKET[market];
  const tpUnits = envNumber(marketEnvName(market, "TP_UNITS")) ?? envNumber("AUTO_TRADE_TEST_TP_UNITS") ?? DEFAULT_TEST_UNITS_BY_MARKET[market];
  const sizeMultiplier =
    envNumber(marketEnvName(market, "SIZE")) ?? envNumber("AUTO_TRADE_TEST_SIZE") ?? DEFAULT_TEST_SIZE_BY_MARKET[market];
  const stopLossPrice = roundToTick(entryPrice - direction * slUnits * asset.tickSize, asset.tickSize);
  const takeProfitPrice = roundToTick(entryPrice + direction * tpUnits * asset.tickSize, asset.tickSize);
  const now = new Date().toISOString();
  const accountPart = accountId == null ? "" : `-${String(accountId).replace(/[^0-9A-Za-z_-]/g, "")}`;

  return {
    createdAt: now,
    entryMode: "Auto-trade test",
    entryPrice,
    entryType: "market",
    estimatedWinRatePct: 0,
    id: `auto-trade-test-${providerId}${accountPart}-${Date.now()}`,
    liveProfitFactor: 0,
    market: asset.market,
    signalTime: now,
    side,
    sizeMultiplier,
    slUnits,
    status: "alerted",
    stopLossPrice,
    strategy: "Auto-trade account test",
    symbol: asset.symbol,
    takeProfitPrice,
    telegramStatus: "skipped",
    tpUnits,
    unitLabel: asset.unitLabel
  };
}
