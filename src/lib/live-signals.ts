import { enrichBars } from "@/lib/indicators";
import { assetForKey, defaultTickSize } from "@/lib/assets";
import { getBacktestStats, type BacktestStat } from "@/lib/backtest";
import { instrumentSizeLabel, recommendedSizeMultiplier } from "@/lib/instruments";
import { getLiveConfig, type SavedCustomScaleRanges, type SavedStrategyEdit } from "@/lib/live-config";
import { STRATEGY_DEFINITIONS } from "@/lib/strategy-loader";
import { conciseStrategyName } from "@/lib/strategy-names";
import type { StrategySignal } from "@/lib/strategy-definition";
import { DEFAULT_STRATEGY_TIMEFRAME, isDataTimeframe, timeframeFromVariant } from "@/lib/timeframes";
import { planTradeAlert } from "@/lib/trade-planner";
import type { Bar, StrategyRule, TradeAlert } from "@/lib/types";

function nextBarEntryMode(rule: StrategyRule): string {
  const timeframe = timeframeFromVariant(rule.variantId, DEFAULT_STRATEGY_TIMEFRAME);
  return `market order enters on the next ${timeframe} open`;
}
const MINIMUM_SIGNAL_BARS = 260;

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

function roundScaleValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function leadingSizeNumber(label: string): number | undefined {
  const match = label.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  return positiveNumber(match[1]);
}

function scaleFromLegacyContracts(rule: StrategyRule, contracts: number | undefined): number | undefined {
  if (!contracts) return undefined;
  const baseSizeMultiplier = positiveNumber(rule.sizeMultiplier) ?? 1;
  const baseContracts = leadingSizeNumber(instrumentSizeLabel(rule.symbol, baseSizeMultiplier));
  return baseContracts ? contracts / baseContracts : undefined;
}

function editScale(rule: StrategyRule, edit: SavedStrategyEdit): number | undefined {
  return scaleFromLegacyContracts(rule, positiveNumber(edit.contracts)) ?? positiveNumber(edit.scale);
}

function scaledSizePolicy(policy: StrategyRule["sizePolicy"], scale: number | undefined): StrategyRule["sizePolicy"] {
  if (!policy || !scale) return policy;
  return {
    ...policy,
    minMultiplier: roundScaleValue(policy.minMultiplier * scale),
    maxMultiplier: roundScaleValue(policy.maxMultiplier * scale)
  };
}

function applyStrategyEdit(
  rule: StrategyRule,
  edit: SavedStrategyEdit | undefined,
  riskRewardRatio: number | undefined
): StrategyRule {
  if (!edit) return rule;

  const editTpUnits = positiveNumber(edit.tpUnits);
  const editSlUnits = positiveNumber(edit.slUnits);
  const editTargetDollars = positiveNumber(edit.targetDollars);
  const editRiskDollars = positiveNumber(edit.riskDollars);
  const editDollarRatio = editTargetDollars && editRiskDollars ? editTargetDollars / editRiskDollars : undefined;
  const editUnitRatio = editTpUnits && editSlUnits ? editTpUnits / editSlUnits : undefined;
  const editRatio = editDollarRatio ?? editUnitRatio;
  const canOverrideLevels =
    editRatio !== undefined && (!riskRewardRatio || editRatio + 0.005 >= riskRewardRatio) && !editTargetDollars && !editRiskDollars;
  const slUnits = canOverrideLevels ? editSlUnits ?? rule.slUnits : rule.slUnits;
  const tpUnits = canOverrideLevels ? riskRewardAdjustedTpUnits(editTpUnits ?? rule.tpUnits, slUnits, riskRewardRatio) : rule.tpUnits;
  const scale = editScale(rule, edit);
  const baseSizeMultiplier = positiveNumber(rule.sizeMultiplier) ?? 1;

  return {
    ...rule,
    tpUnits,
    slUnits,
    sizeScale: scale ?? rule.sizeScale,
    sizePolicy: scaledSizePolicy(rule.sizePolicy, scale),
    sizeMultiplier: scale ? roundScaleValue(baseSizeMultiplier * scale) : rule.sizeMultiplier
  };
}

function customScaleRangeForRule(rule: StrategyRule, ranges: SavedCustomScaleRanges): StrategyRule["customScaleRange"] {
  if (rule.market === "gold_spot") return ranges.gold_spot ?? ranges.forex;
  if (rule.market === "forex" || rule.market === "futures") return ranges[rule.market];
  return undefined;
}

function explicitRuleTimeframe(rule: StrategyRule): string | null {
  return rule.variantId?.split("|").find((part) => part.startsWith("tf="))?.slice(3) || null;
}

function isSupportedLiveTimeframe(rule: StrategyRule): boolean {
  const timeframe = explicitRuleTimeframe(rule);
  return !timeframe || isDataTimeframe(timeframe);
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function riskRewardAdjustedTpUnits(tpUnits: number, slUnits: number, riskRewardRatio: number | undefined): number {
  if (!finiteNumber(riskRewardRatio) || riskRewardRatio <= 0 || slUnits <= 0) return tpUnits;
  const plannedTpUnits = slUnits * riskRewardRatio;
  return tpUnits / slUnits + 0.005 < riskRewardRatio ? plannedTpUnits : tpUnits;
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

function statToRule(
  stat: BacktestStat,
  strategyEdits: Record<string, SavedStrategyEdit> = {},
  customScaleRanges: SavedCustomScaleRanges = {}
): StrategyRule | null {
  const strategy = STRATEGY_DEFINITIONS.find((item) => item.id === stat.datasetId);
  if (!strategy || !strategy.liveEnabled) return null;
  const asset = assetForKey(strategy.assetKey);
  const defaults = strategy.defaults ?? {};
  const slUnits = stat.slUnits ?? defaults.slUnits ?? 0;
  const plannedRiskRewardRatio = stat.riskRewardRatio ?? defaults.selectedRiskReward ?? defaults.minimumRiskReward ?? defaults.ictRiskReward;
  const tpUnits = riskRewardAdjustedTpUnits(
    stat.tpUnits ?? defaults.tpUnits ?? 0,
    slUnits,
    plannedRiskRewardRatio
  );

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
    label: conciseStrategyName({
      assetKey: strategy.assetKey,
      label: strategy.label,
      phase: strategy.phase,
      symbol: asset.symbol,
      variantId: stat.variantId ?? defaults.variantId
    }),
    variantId: stat.variantId ?? defaults.variantId,
    source: stat.source ?? defaults.source,
    signalAtrMult: stat.signalAtrMult ?? defaults.signalAtrMult,
    recentSignalLookback: stat.recentSignalLookback ?? defaults.recentSignalLookback,
    absCloseEma200AtrMax: stat.absCloseEma200AtrMax ?? defaults.absCloseEma200AtrMax,
    tradeRsiMin: stat.tradeRsiMin ?? defaults.tradeRsiMin,
    tradeRsiMax: stat.tradeRsiMax ?? defaults.tradeRsiMax,
    ictRiskReward: defaults.ictRiskReward,
    tpUnits,
    slUnits,
    tickSize: stat.pipOrTickSize ?? defaultTickSize(asset.symbol, asset.market),
    unitLabel: asset.unitLabel,
    customScaleRange: undefined,
    sizeMultiplier:
      stat.sizeMultiplier ??
      defaults.sizeMultiplier ??
      recommendedSizeMultiplier({
        symbol: asset.symbol,
        tpUnits,
        slUnits
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

  return {
    ...applyStrategyEdit(baseRule, strategyEdits[stat.datasetId], plannedRiskRewardRatio),
    customScaleRange: customScaleRangeForRule(baseRule, customScaleRanges)
  };
}

export async function allRules(): Promise<StrategyRule[]> {
  try {
    const [stats, config] = await Promise.all([getBacktestStats(), getLiveConfig()]);
    return uniqueRules(
      stats.map((stat) => statToRule(stat, config.strategyEdits, config.customScaleRanges)).filter((rule): rule is StrategyRule => Boolean(rule))
    );
  } catch {
    return [];
  }
}

export async function activeRules(): Promise<StrategyRule[]> {
  const [stats, config] = await Promise.all([getBacktestStats(), getLiveConfig()]);
  const rules = uniqueRules(
    stats.map((stat) => statToRule(stat, config.strategyEdits, config.customScaleRanges)).filter((rule): rule is StrategyRule => Boolean(rule))
  );
  const selectedDatasetIds = config.enabledDatasetIds.length ? config.enabledDatasetIds : config.dashboardSelectedDatasetIds;
  if (!selectedDatasetIds.length) return [];

  const enabled = new Set(selectedDatasetIds);
  return rules.filter((rule) => rule.datasetId && enabled.has(rule.datasetId) && isSupportedLiveTimeframe(rule));
}

export function evaluateLatestSignal(rule: StrategyRule, rawBars: Bar[]): TradeAlert | null {
  return evaluateRecentSignals(rule, rawBars, { maxBars: 1 }).at(-1) ?? null;
}

export function evaluateRecentSignals(
  rule: StrategyRule,
  rawBars: Bar[],
  options: { maxBars?: number; sinceMs?: number } = {}
): TradeAlert[] {
  if (rawBars.length < MINIMUM_SIGNAL_BARS) return [];
  const strategy = STRATEGY_DEFINITIONS.find((item) => item.id === rule.strategyId);
  if (!strategy) return [];
  const bars = enrichBars(rawBars);
  const configuredMaxBars = positiveNumber(options.maxBars);
  const maxBars = configuredMaxBars ? Math.max(1, Math.trunc(configuredMaxBars)) : bars.length;
  const startIndex = Math.max(MINIMUM_SIGNAL_BARS - 1, bars.length - maxBars);
  const signals: TradeAlert[] = [];

  for (let signalIndex = startIndex; signalIndex < bars.length; signalIndex += 1) {
    const signalTime = Date.parse(bars[signalIndex]?.time ?? "");
    if (options.sinceMs !== undefined && (!Number.isFinite(signalTime) || signalTime < options.sinceMs)) continue;

    const rawSignal = strategy.evaluator(rule, bars, signalIndex);
    if (!rawSignal) continue;
    const signal = invertStrategySignal(rule, rawSignal);
    const planned = planTradeAlert(rule, signal, bars, signalIndex, nextBarEntryMode(rule));
    if (planned) signals.push(planned);
  }

  return signals;
}
