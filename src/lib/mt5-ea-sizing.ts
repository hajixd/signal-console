import { defaultTickSize } from "@/lib/assets";
import { dollarPerUnit } from "@/lib/instruments";
import { plannedAutoTradeSizeForTrade, tradeLevels } from "@/lib/auto-trade-utils";
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

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) return Math.min(8, Number(text.split("e-")[1]) || 0);
  return Math.min(8, text.split(".")[1]?.length ?? 0);
}

function roundDownToLotStep(lots: number): number {
  const configuredStep = numEnv("MT5_EA_LOT_STEP", 0.01);
  const step = configuredStep > 0 ? configuredStep : 0.01;
  const configuredMin = numEnv("MT5_EA_MIN_LOT", 0.01);
  const minLot = configuredMin > 0 ? configuredMin : step;
  const configuredMax = numEnv("MT5_EA_MAX_LOT", 50);
  const maxLot = configuredMax >= minLot ? configuredMax : minLot;
  if (!Number.isFinite(lots) || lots + Number.EPSILON < minLot) return 0;

  const bounded = Math.min(lots, maxLot);
  const stepped = Math.floor((bounded + Number.EPSILON) / step) * step;
  if (stepped + Number.EPSILON < minLot) return 0;
  return Number(stepped.toFixed(Math.max(2, decimalPlaces(step))));
}

function sharedExecutionLotCap(trade: TradeAlert): number {
  // The shared sizing model expresses forex size in 0.1-lot units. This cap
  // carries per-check and other upstream risk reductions into the MT5 queue.
  return Math.max(0, plannedAutoTradeSizeForTrade(trade) * SIZE_UNIT_LOTS);
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

  const overrideLots = parseMap(process.env.MT5_EA_LOT_OVERRIDE)[symbol];
  const configuredBalance = numEnv("MT5_EA_ACCOUNT_BALANCE", 100_000);
  const liveBalance = await getLatestAccountBalance(bridgeAccountId).catch(() => null);
  const balance = liveBalance && liveBalance > 0 ? liveBalance : Math.max(0, configuredBalance);
  const riskPct = mt5RiskPerTradePct();
  const riskBudgetUsd = balance * riskPct;
  const { stopLossPrice } = tradeLevels(trade);
  const tickSize = defaultTickSize(trade.symbol, "forex");
  const stopDistance = Math.abs(trade.entryPrice - stopLossPrice);
  const stopTicks = tickSize > 0 ? stopDistance / tickSize : 0;

  // Per-symbol pip-value calibration override, else config dollarPerUnit * 10.
  const pipValueOverride = parseMap(process.env.MT5_EA_PIP_VALUE_OVERRIDE)[symbol];
  const pipValuePerLot = pipValueOverride && pipValueOverride > 0
    ? pipValueOverride
    : dollarPerUnit(trade.symbol) / SIZE_UNIT_LOTS;
  const lotCap = sharedExecutionLotCap(trade);

  if (!(stopTicks > 0) || !(pipValuePerLot > 0) || !(riskBudgetUsd > 0) || !(lotCap > 0)) {
    return {
      lots: 0,
      riskUsd: 0,
      balance,
      stopTicks,
      reason: `no risk-safe executable lot (stopTicks=${stopTicks.toFixed(1)}, pipValue=${pipValuePerLot}, lotCap=${lotCap})`
    };
  }

  const riskBasedLots = riskBudgetUsd / (stopTicks * pipValuePerLot);
  const requestedLots = overrideLots && overrideLots > 0 ? overrideLots : riskBasedLots;
  const cappedLots = Math.min(requestedLots, lotCap);
  const lots = roundDownToLotStep(cappedLots);
  const riskUsd = lots * stopTicks * pipValuePerLot;
  const capReason = lotCap + 1e-9 < requestedLots
    ? `; shared execution guard capped ${requestedLots.toFixed(4)} lots at ${lotCap.toFixed(4)}`
    : "";
  return {
    lots,
    riskUsd,
    balance,
    stopTicks,
    reason: overrideLots && overrideLots > 0
      ? `lot override ${overrideLots} for ${symbol}${capReason}; actual risk $${riskUsd.toFixed(2)}`
      : `risk ${(riskPct * 100).toFixed(2)}% of ${balance} = $${riskBudgetUsd.toFixed(0)} over ${stopTicks.toFixed(1)} pips${capReason}; actual risk $${riskUsd.toFixed(2)}`
  };
}
