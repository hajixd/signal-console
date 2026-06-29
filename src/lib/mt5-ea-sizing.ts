import { defaultTickSize } from "@/lib/assets";
import { dollarPerUnit } from "@/lib/instruments";
import { tradeLevels } from "@/lib/auto-trade-utils";
import { getLatestAccountBalance } from "@/lib/mt5-ea-state";
import type { TradeAlert } from "@/lib/types";

/**
 * Risk-based MT5 lot sizing.
 *
 * Each trade risks a constant fraction of the account so realized R per trade
 * matches the backtest R the strategies were validated on.
 *
 *   riskUsd       = balance * riskPerTradePct
 *   stopTicks     = |entry - stop| / tickSize           (pips)
 *   pipValuePerLot= dollarPerUnit * 10                  (USD/pip for 1.0 lot)
 *   lots          = riskUsd / (stopTicks * pipValuePerLot)
 *
 * `dollarPerUnit` from config/assets.json is the USD value of one tick (pip)
 * for one "size unit" = 0.1 FX lot, so a full 1.0 lot is 10x that.
 */

const SIZE_UNIT_LOTS = 0.1; // one config "size unit" == 0.1 FX lot

function numEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function parseMap(raw: string | undefined): Record<string, number> {
  if (!raw?.trim()) return {};
  const out: Record<string, number> = {};
  for (const entry of raw.split(",")) {
    const [key, value] = entry.split(":");
    const symbol = key?.trim().toUpperCase();
    const num = Number(value?.trim());
    if (symbol && Number.isFinite(num) && num > 0) out[symbol] = num;
  }
  return out;
}

export function mt5RiskPerTradePct(): number {
  // Stored as a percent (0.5 == 0.5%). Clamp to a sane 0..5% band.
  const pct = numEnv("MT5_EA_RISK_PER_TRADE_PCT", 0.5);
  return Math.min(5, Math.max(0, pct)) / 100;
}

function clampToStep(lots: number): number {
  const step = numEnv("MT5_EA_LOT_STEP", 0.01);
  const minLot = numEnv("MT5_EA_MIN_LOT", 0.01);
  const maxLot = numEnv("MT5_EA_MAX_LOT", 50);
  const stepped = Math.floor(lots / step) * step;
  const clamped = Math.min(maxLot, Math.max(minLot, stepped));
  // Avoid float dust like 0.30000000000000004.
  return Number(clamped.toFixed(2));
}

export type Mt5Sizing = {
  lots: number;
  riskUsd: number;
  balance: number;
  stopTicks: number;
  reason: string;
};

/**
 * Resolve the MT5 lot size for a forex trade. Returns the configured live
 * balance (or the EA-reported balance if available) and the computed risk.
 */
export async function resolveMt5Lots(trade: TradeAlert, bridgeAccountId: string): Promise<Mt5Sizing> {
  const symbol = trade.symbol.trim().toUpperCase();

  // 1. Hard per-symbol override wins (calibration / manual control).
  const overrideLots = parseMap(process.env.MT5_EA_LOT_OVERRIDE)[symbol];
  const configuredBalance = numEnv("MT5_EA_ACCOUNT_BALANCE", 100_000);
  const liveBalance = await getLatestAccountBalance(bridgeAccountId).catch(() => null);
  const balance = liveBalance && liveBalance > 0 ? liveBalance : configuredBalance;

  if (overrideLots && overrideLots > 0) {
    return {
      lots: clampToStep(overrideLots),
      riskUsd: 0,
      balance,
      stopTicks: 0,
      reason: `lot override ${overrideLots} for ${symbol}`
    };
  }

  // 2. Risk-based sizing off the (live or configured) balance.
  const riskPct = mt5RiskPerTradePct();
  const riskUsd = balance * riskPct;
  const { stopLossPrice } = tradeLevels(trade);
  const tickSize = defaultTickSize(trade.symbol, "forex");
  const stopDistance = Math.abs(trade.entryPrice - stopLossPrice);
  const stopTicks = tickSize > 0 ? stopDistance / tickSize : 0;

  // Per-symbol pip-value calibration override, else config dollarPerUnit * 10.
  const pipValueOverride = parseMap(process.env.MT5_EA_PIP_VALUE_OVERRIDE)[symbol];
  const pipValuePerLot = pipValueOverride && pipValueOverride > 0
    ? pipValueOverride
    : dollarPerUnit(trade.symbol) / SIZE_UNIT_LOTS;

  if (!(stopTicks > 0) || !(pipValuePerLot > 0) || !(riskUsd > 0)) {
    const fallback = clampToStep(numEnv("MT5_EA_MIN_LOT", 0.01));
    return {
      lots: fallback,
      riskUsd,
      balance,
      stopTicks,
      reason: `fallback min lot (stopTicks=${stopTicks.toFixed(1)}, pipValue=${pipValuePerLot})`
    };
  }

  const rawLots = riskUsd / (stopTicks * pipValuePerLot);
  return {
    lots: clampToStep(rawLots),
    riskUsd,
    balance,
    stopTicks,
    reason: `risk ${(riskPct * 100).toFixed(2)}% of ${balance} = $${riskUsd.toFixed(0)} over ${stopTicks.toFixed(1)} pips`
  };
}
