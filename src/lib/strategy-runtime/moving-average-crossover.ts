import type { EnrichedBar } from "@/lib/indicators";
import type { Side, StrategyRule } from "@/lib/types";
import type { StrategySignal } from "@/lib/strategy-definition";
import { LONG, SHORT } from "./constants";
import { roundToTick } from "./helpers";

type AverageSpec = {
  kind: "EMA" | "SMA";
  length: number;
};

function variantValue(variantId: string | undefined, key: string): string | undefined {
  if (!variantId) return undefined;
  for (const token of variantId.split("|")) {
    const [tokenKey, rawValue] = token.split("=");
    if (tokenKey === key && rawValue) return rawValue;
  }
  return undefined;
}

function averageSpec(value: string | undefined, fallback: string): AverageSpec {
  const raw = value ?? fallback;
  const match = raw.match(/^(EMA|SMA)(\d+)$/i);
  return {
    kind: match?.[1]?.toUpperCase() === "EMA" ? "EMA" : "SMA",
    length: Math.max(2, Number(match?.[2] ?? 20))
  };
}

function smaAt(bars: EnrichedBar[], index: number, length: number): number | null {
  if (index + 1 < length) return null;
  let total = 0;
  for (let cursor = index - length + 1; cursor <= index; cursor += 1) {
    total += bars[cursor]!.close;
  }
  return total / length;
}

function emaAt(bars: EnrichedBar[], index: number, length: number): number | null {
  if (length === 9) return bars[index]?.ema9 ?? null;
  if (length === 21) return bars[index]?.ema21 ?? null;
  if (length === 34) return bars[index]?.ema34 ?? null;
  if (length === 50) return bars[index]?.ema50 ?? null;
  if (length === 200) return bars[index]?.ema200 ?? null;
  if (index < 0) return null;

  const alpha = 2 / (length + 1);
  let current = bars[0]!.close;
  for (let cursor = 1; cursor <= index; cursor += 1) {
    current = alpha * bars[cursor]!.close + (1 - alpha) * current;
  }
  return current;
}

function averageAt(bars: EnrichedBar[], index: number, spec: AverageSpec): number | null {
  if (index < 0) return null;
  return spec.kind === "EMA" ? emaAt(bars, index, spec.length) : smaAt(bars, index, spec.length);
}

export function evaluateMovingAverageCrossover(
  rule: StrategyRule,
  bars: EnrichedBar[],
  signalIndex: number
): StrategySignal | null {
  const signalBar = bars[signalIndex];
  if (!signalBar || signalIndex <= 0 || rule.tickSize <= 0) return null;

  const fast = averageSpec(variantValue(rule.variantId, "fast"), "SMA50");
  const slow = averageSpec(variantValue(rule.variantId, "slow"), "SMA200");
  const direction = variantValue(rule.variantId, "direction") ?? "long";

  const fastNow = averageAt(bars, signalIndex, fast);
  const slowNow = averageAt(bars, signalIndex, slow);
  const fastPrior = averageAt(bars, signalIndex - 1, fast);
  const slowPrior = averageAt(bars, signalIndex - 1, slow);
  if (fastNow === null || slowNow === null || fastPrior === null || slowPrior === null) return null;

  let side: Side | null = null;
  if ((direction === "long" || direction === "both") && fastPrior <= slowPrior && fastNow > slowNow) {
    side = LONG;
  } else if ((direction === "short" || direction === "both") && fastPrior >= slowPrior && fastNow < slowNow) {
    side = SHORT;
  }
  if (!side) return null;

  const sideSign = side === LONG ? 1 : -1;
  const entryPrice = roundToTick(signalBar.close, rule.tickSize);
  const tpUnits = rule.tpUnits;
  const slUnits = rule.slUnits;

  return {
    side,
    entryPrice,
    takeProfitPrice: roundToTick(entryPrice + sideSign * tpUnits * rule.tickSize, rule.tickSize),
    stopLossPrice: roundToTick(entryPrice - sideSign * slUnits * rule.tickSize, rule.tickSize),
    tpUnits,
    slUnits,
    signalTime: signalBar.time,
    notes: `${fast.kind}${fast.length}/${slow.kind}${slow.length} ${side} crossover`
  };
}
