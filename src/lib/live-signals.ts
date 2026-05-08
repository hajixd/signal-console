import { enrichBars } from "@/lib/indicators";
import { assetForKey, defaultTickSize } from "@/lib/assets";
import { getBacktestStats, type BacktestStat } from "@/lib/backtest";
import { recommendedSizeMultiplier } from "@/lib/instruments";
import { getLiveConfig, type SavedStrategyEdit } from "@/lib/live-config";
import { STRATEGY_DEFINITIONS } from "@/lib/strategy-loader";
import type { StrategySignal } from "@/lib/strategy-definition";
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

function positiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function applyStrategyEdit(rule: StrategyRule, edit: SavedStrategyEdit | undefined): StrategyRule {
  if (!edit) return rule;

  const tpUnits = positiveNumber(edit.tpUnits);
  const slUnits = positiveNumber(edit.slUnits);
  const sizeMultiplier = positiveNumber(edit.contracts);

  return {
    ...rule,
    tpUnits: tpUnits ?? rule.tpUnits,
    slUnits: slUnits ?? rule.slUnits,
    sizeMultiplier: sizeMultiplier ?? rule.sizeMultiplier
  };
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function invertStrategySignal(rule: StrategyRule, signal: StrategySignal): StrategySignal {
  if (!rule.invertSignal) return signal;

  const priorDirection = signal.side === "long" ? 1 : -1;
  const priorStopLossPrice = signal.stopLossPrice;
  const impliedTakeProfitPrice =
    finiteNumber(signal.takeProfitPrice)
      ? signal.takeProfitPrice
      : finiteNumber(signal.riskReward) && signal.riskReward > 0
        ? signal.entryPrice + priorDirection * Math.abs(signal.entryPrice - priorStopLossPrice) * signal.riskReward
        : signal.entryPrice + priorDirection * signal.tpUnits * rule.tickSize;

  return {
    ...signal,
    side: signal.side === "long" ? "short" : "long",
    takeProfitPrice: priorStopLossPrice,
    stopLossPrice: impliedTakeProfitPrice,
    tpUnits: signal.slUnits,
    slUnits: signal.tpUnits,
    notes: signal.notes ? `${signal.notes} Live inverse applied.` : "Live inverse applied."
  };
}

function statToRule(stat: BacktestStat, strategyEdits: Record<string, SavedStrategyEdit> = {}): StrategyRule | null {
  const strategy = STRATEGY_DEFINITIONS.find((item) => item.id === stat.datasetId);
  if (!strategy || !strategy.liveEnabled) return null;
  const asset = assetForKey(strategy.assetKey);
  const defaults = strategy.defaults ?? {};

  const baseRule: StrategyRule = {
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
    echoModel: defaults.echoModel,
    oneTradePerDay: defaults.oneTradePerDay,
    costUnits: defaults.costUnits,
    estimatedWinRatePct: stat.winRatePct,
    liveProfitFactor: stat.profitFactor,
    invertSignal: stat.invertSignal ?? defaults.invertSignal ?? false
  };

  return applyStrategyEdit(baseRule, strategyEdits[stat.datasetId]);
}

export async function allRules(): Promise<StrategyRule[]> {
  try {
    return uniqueRules((await getBacktestStats()).map((stat) => statToRule(stat)).filter((rule): rule is StrategyRule => Boolean(rule)));
  } catch {
    return [];
  }
}

export async function activeRules(): Promise<StrategyRule[]> {
  const [stats, config] = await Promise.all([getBacktestStats(), getLiveConfig()]);
  const rules = uniqueRules(
    stats.map((stat) => statToRule(stat, config.strategyEdits)).filter((rule): rule is StrategyRule => Boolean(rule))
  );
  const selectedDatasetIds = config.enabledDatasetIds.length ? config.enabledDatasetIds : config.dashboardSelectedDatasetIds;
  if (!selectedDatasetIds.length) return [];

  const enabled = new Set(selectedDatasetIds);
  return rules.filter((rule) => rule.datasetId && enabled.has(rule.datasetId));
}

export function evaluateLatestSignal(rule: StrategyRule, rawBars: Bar[]): TradeAlert | null {
  if (rawBars.length < 260) return null;
  const strategy = STRATEGY_DEFINITIONS.find((item) => item.id === rule.strategyId);
  if (!strategy) return null;
  const bars = enrichBars(rawBars);
  const signalIndex = bars.length - 1;
  const rawSignal = strategy.evaluator(rule, bars, signalIndex);
  if (!rawSignal) return null;
  const signal = invertStrategySignal(rule, rawSignal);
  return planTradeAlert(rule, signal, bars, signalIndex, NEXT_BAR_ENTRY_MODE);
}
