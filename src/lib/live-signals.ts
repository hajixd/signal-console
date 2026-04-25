import { enrichBars } from "@/lib/indicators";
import { assetForKey, defaultTickSize } from "@/lib/assets";
import { getBacktestStats, type BacktestStat } from "@/lib/backtest";
import { recommendedSizeMultiplier } from "@/lib/instruments";
import { getLiveConfig } from "@/lib/live-config";
import { STRATEGY_DEFINITIONS } from "@/lib/strategy-loader";
import { planTradeAlert } from "@/lib/trade-planner";
import type { Bar, StrategyRule, TradeAlert } from "@/lib/types";

const NEXT_BAR_ENTRY_MODE = "market order enters on the next 15m open";

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

function statToRule(stat: BacktestStat): StrategyRule | null {
  const strategy = STRATEGY_DEFINITIONS.find((item) => item.id === stat.datasetId);
  if (!strategy || !strategy.liveEnabled) return null;
  const asset = assetForKey(strategy.assetKey);
  const defaults = strategy.defaults ?? {};

  return {
    key: stat.key,
    logicalKey: stat.logicalKey,
    datasetId: stat.datasetId,
    strategyId: strategy.id,
    assetKey: strategy.assetKey,
    market: asset.market,
    symbol: asset.symbol,
    databentoSymbol: asset.databentoSymbol,
    phase: strategy.phase,
    label: strategy.label,
    variantId: stat.variantId ?? defaults.variantId,
    source: stat.source ?? defaults.source,
    signalAtrMult: stat.signalAtrMult ?? defaults.signalAtrMult,
    recentSignalLookback: stat.recentSignalLookback ?? defaults.recentSignalLookback,
    absCloseEma200AtrMax: stat.absCloseEma200AtrMax ?? defaults.absCloseEma200AtrMax,
    tradeRsiMin: stat.tradeRsiMin ?? defaults.tradeRsiMin,
    tradeRsiMax: stat.tradeRsiMax ?? defaults.tradeRsiMax,
    ictRiskReward: defaults.ictRiskReward,
    tpUnits: stat.tpUnits ?? defaults.tpUnits ?? 0,
    slUnits: stat.slUnits ?? defaults.slUnits ?? 0,
    tickSize: stat.pipOrTickSize ?? defaultTickSize(asset.symbol, asset.market),
    unitLabel: asset.unitLabel,
    sizeMultiplier:
      stat.sizeMultiplier ??
      defaults.sizeMultiplier ??
      recommendedSizeMultiplier({
        symbol: asset.symbol,
        tpUnits: stat.tpUnits,
        slUnits: stat.slUnits
      }),
    stopLossPolicy: defaults.stopLossPolicy,
    takeProfitPolicy: defaults.takeProfitPolicy,
    sizePolicy: defaults.sizePolicy,
    dynamicStopLossPolicy: defaults.dynamicStopLossPolicy,
    dynamicTakeProfitPolicy: defaults.dynamicTakeProfitPolicy,
    oneTradePerDay: defaults.oneTradePerDay,
    costUnits: defaults.costUnits,
    estimatedWinRatePct: stat.winRatePct,
    liveProfitFactor: stat.profitFactor,
    invertSignal: stat.invertSignal ?? defaults.invertSignal ?? false
  };
}

export async function allRules(): Promise<StrategyRule[]> {
  try {
    return uniqueRules((await getBacktestStats()).map(statToRule).filter((rule): rule is StrategyRule => Boolean(rule)));
  } catch {
    return [];
  }
}

export async function activeRules(): Promise<StrategyRule[]> {
  const [rules, config] = await Promise.all([allRules(), getLiveConfig()]);
  const enabled = new Set(config.enabledDatasetIds);
  return enabled.size ? rules.filter((rule) => rule.datasetId && enabled.has(rule.datasetId)) : rules;
}

export function evaluateLatestSignal(rule: StrategyRule, rawBars: Bar[]): TradeAlert | null {
  if (rawBars.length < 260) return null;
  const strategy = STRATEGY_DEFINITIONS.find((item) => item.id === rule.strategyId);
  if (!strategy) return null;
  const bars = enrichBars(rawBars);
  const signalIndex = bars.length - 1;
  const signal = strategy.evaluator(rule, bars, signalIndex);
  if (!signal) return null;
  return planTradeAlert(rule, signal, bars, signalIndex, NEXT_BAR_ENTRY_MODE);
}
