import { strategyEvaluatorForPhase, strategyPhaseIsLive } from "@/core/strategies/registry";
import { evaluateSignalWith } from "@/core/strategies/shared/evaluator";
import { getBacktestStats, type BacktestStat } from "@/lib/backtest";
import { defaultTickSize } from "@/lib/strategy-sources";
import { instrumentUnitLabel, recommendedSizeMultiplier } from "@/lib/instruments";
import type { Bar, Market, StrategyRule, TradeAlert } from "@/lib/types";

const DATABENTO_SYMBOLS: Record<string, string> = {
  "6A": "6A.v.0",
  "6B": "6B.v.0",
  "6C": "6C.v.0",
  "6E": "6E.v.0",
  "6J": "6J.v.0",
  CL: "CL.v.0",
  ES: "ES.v.0",
  GC: "GC.v.0",
  HG: "HG.v.0",
  NG: "NG.v.0",
  NQ: "NQ.v.0",
  RTY: "RTY.v.0",
  SI: "SI.v.0",
  YM: "YM.v.0",
  ZB: "ZB.v.0",
  ZN: "ZN.v.0"
};

function isMarket(value: string | undefined): value is Market {
  return value === "futures" || value === "forex" || value === "gold_spot";
}

function variantNumber(variantId: string | undefined, key: string): number | undefined {
  if (!variantId) return undefined;
  for (const part of variantId.split("|")) {
    const [partKey, rawValue] = part.split("=", 2);
    if (partKey !== key || rawValue === undefined || rawValue === "" || rawValue === "none") continue;
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function statToRule(stat: BacktestStat): StrategyRule | null {
  const market = isMarket(stat.market) ? stat.market : undefined;
  if (!market || !strategyPhaseIsLive(stat.phase)) return null;

  return {
    key: stat.logicalKey,
    logicalKey: stat.logicalKey,
    datasetId: stat.datasetId,
    market,
    symbol: stat.symbol,
    databentoSymbol: market === "futures" ? DATABENTO_SYMBOLS[stat.symbol] : undefined,
    phase: stat.phase,
    label: stat.label,
    variantId: stat.variantId,
    source: stat.source,
    signalAtrMult: stat.signalAtrMult,
    recentSignalLookback: stat.recentSignalLookback,
    absCloseEma200AtrMax: stat.absCloseEma200AtrMax,
    tradeRsiMin: stat.tradeRsiMin,
    tradeRsiMax: stat.tradeRsiMax,
    squeezeLookback: variantNumber(stat.variantId, "lookback"),
    squeezeThreshold: variantNumber(stat.variantId, "threshold"),
    ictRiskReward: variantNumber(stat.variantId, "rr"),
    tpUnits: stat.tpUnits ?? 0,
    slUnits: stat.slUnits ?? 0,
    tickSize: stat.pipOrTickSize ?? defaultTickSize(stat.symbol, market),
    unitLabel: instrumentUnitLabel(stat.symbol),
    sizeMultiplier:
      stat.sizeMultiplier ??
      recommendedSizeMultiplier({
        symbol: stat.symbol,
        tpUnits: stat.tpUnits,
        slUnits: stat.slUnits,
        costUnits: stat.costUnits
      }),
    estimatedWinRatePct: stat.winRatePct,
    liveProfitFactor: stat.profitFactor,
    invertSignal: stat.invertSignal
  };
}

function betterRule(nextRule: StrategyRule, currentRule: StrategyRule): boolean {
  if (nextRule.liveProfitFactor !== currentRule.liveProfitFactor) {
    return nextRule.liveProfitFactor > currentRule.liveProfitFactor;
  }
  if (nextRule.estimatedWinRatePct !== currentRule.estimatedWinRatePct) {
    return nextRule.estimatedWinRatePct > currentRule.estimatedWinRatePct;
  }
  return Boolean(nextRule.source) && !currentRule.source;
}

function uniqueRules(rules: StrategyRule[]): StrategyRule[] {
  const ruleByKey = new Map<string, StrategyRule>();
  for (const rule of rules) {
    const current = ruleByKey.get(rule.logicalKey);
    if (!current || betterRule(rule, current)) {
      ruleByKey.set(rule.logicalKey, rule);
    }
  }
  return [...ruleByKey.values()];
}

export async function allRules(): Promise<StrategyRule[]> {
  try {
    return uniqueRules((await getBacktestStats()).map(statToRule).filter((rule): rule is StrategyRule => Boolean(rule)));
  } catch {
    return [];
  }
}

export async function activeRules(): Promise<StrategyRule[]> {
  return allRules();
}

export function evaluateLatestSignal(rule: StrategyRule, rawBars: Bar[]): TradeAlert | null {
  const evaluator = strategyEvaluatorForPhase(rule.phase);
  return evaluator ? evaluateSignalWith(rule, rawBars, evaluator) : null;
}
