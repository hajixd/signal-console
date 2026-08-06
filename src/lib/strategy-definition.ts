import type { EnrichedBar } from "@/lib/indicators";
import type {
  DynamicStopLossPolicy,
  DynamicTakeProfitPolicy,
  EchoNeuralModel,
  EntryType,
  SizePolicy,
  StopLossPolicy,
  StrategyRule,
  TakeProfitPolicy
} from "@/lib/types";

export type StrategySignal = {
  side: "long" | "short";
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  tpUnits: number;
  slUnits: number;
  signalTime: string;
  entryMode?: string;
  entryType?: EntryType;
  stopLossMode?: "price" | "units";
  takeProfitMode?: "price" | "units" | "risk_multiple";
  riskReward?: number;
  score?: number;
  confidence?: number;
  sizeMultiplier?: number;
  notes?: string;
};

export type StrategyRuntimeDefaults = {
  variantId?: string;
  source?: string;
  signalAtrMult?: number;
  recentSignalLookback?: number;
  absCloseEma200AtrMax?: number;
  tradeRsiMin?: number;
  tradeRsiMax?: number;
  ictRiskReward?: number;
  minimumRiskReward?: number;
  selectedRiskReward?: number;
  tpUnits?: number;
  slUnits?: number;
  sizeMultiplier?: number;
  stopLossPolicy?: StopLossPolicy;
  takeProfitPolicy?: TakeProfitPolicy;
  sizePolicy?: SizePolicy;
  dynamicStopLossPolicy?: DynamicStopLossPolicy;
  dynamicTakeProfitPolicy?: DynamicTakeProfitPolicy;
  echoModel?: EchoNeuralModel;
  oneTradePerDay?: boolean;
  costUnits?: number;
  invertSignal?: boolean;
};

type StrategyMetadataStopLossPolicy = {
  mode?: string | null;
  bufferUnits?: number | null;
};

type StrategyMetadataTakeProfitPolicy = {
  mode?: string | null;
  bufferUnits?: number | null;
  rewardMultiple?: number | null;
};

type StrategyMetadataSizePolicy = {
  mode?: string | null;
  minMultiplier?: number | null;
  maxMultiplier?: number | null;
  minConfidence?: number | null;
  maxConfidence?: number | null;
};

type StrategyMetadataDynamicStopLossPolicy = {
  mode?: string | null;
  bufferUnits?: number | null;
  triggerMultiple?: number | null;
  lockMultiple?: number | null;
};

type StrategyMetadataDynamicTakeProfitPolicy = {
  mode?: string | null;
  bufferUnits?: number | null;
  rewardMultiple?: number | null;
};

type StrategyMetadataEchoNeuralModel = {
  kind?: string | null;
  threshold?: number | null;
  featureNames?: string[] | null;
  featureMeans?: number[] | null;
  featureScales?: number[] | null;
  hiddenWeights?: number[][] | null;
  hiddenBias?: number[] | null;
  outputWeights?: number[] | null;
  outputBias?: number | null;
};

export type StrategyMetadataDefaults = {
  variantId?: string | null;
  source?: string | null;
  signalAtrMult?: number | null;
  recentSignalLookback?: number | null;
  absCloseEma200AtrMax?: number | null;
  tradeRsiMin?: number | null;
  tradeRsiMax?: number | null;
  ictRiskReward?: number | null;
  minimumRiskReward?: number | null;
  selectedRiskReward?: number | null;
  tpUnits?: number | null;
  slUnits?: number | null;
  sizeMultiplier?: number | null;
  stopLossPolicy?: StrategyMetadataStopLossPolicy | null;
  takeProfitPolicy?: StrategyMetadataTakeProfitPolicy | null;
  sizePolicy?: StrategyMetadataSizePolicy | null;
  dynamicStopLossPolicy?: StrategyMetadataDynamicStopLossPolicy | null;
  dynamicTakeProfitPolicy?: StrategyMetadataDynamicTakeProfitPolicy | null;
  echoModel?: StrategyMetadataEchoNeuralModel | null;
  oneTradePerDay?: boolean | null;
  costUnits?: number | null;
  invertSignal?: boolean | null;
};

export type StrategyDefinition = {
  id: string;
  label: string;
  folder: string;
  fileName: string;
  backtestFileName: string;
  assetKey: string;
  phase: string;
  liveEnabled: boolean;
  evaluator: (rule: StrategyRule, bars: EnrichedBar[], signalIndex: number) => StrategySignal | null;
  defaults?: StrategyRuntimeDefaults;
};

function definedNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function definedBoolean(value: boolean | null | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeStopLossPolicy(policy: StrategyMetadataStopLossPolicy | null | undefined): StopLossPolicy | undefined {
  if (!policy) return undefined;
  if (policy.mode !== "signal_extreme" && policy.mode !== "prior_day_extreme") return undefined;
  const bufferUnits = definedNumber(policy.bufferUnits);
  return {
    mode: policy.mode,
    ...(bufferUnits === undefined ? {} : { bufferUnits })
  };
}

function normalizeTakeProfitPolicy(
  policy: StrategyMetadataTakeProfitPolicy | null | undefined
): TakeProfitPolicy | undefined {
  if (!policy) return undefined;
  if (
    policy.mode !== "risk_multiple" &&
    policy.mode !== "signal_extreme" &&
    policy.mode !== "prior_day_extreme"
  ) {
    return undefined;
  }
  const bufferUnits = definedNumber(policy.bufferUnits);
  const rewardMultiple = definedNumber(policy.rewardMultiple);
  return {
    mode: policy.mode,
    ...(bufferUnits === undefined ? {} : { bufferUnits }),
    ...(rewardMultiple === undefined ? {} : { rewardMultiple })
  };
}

function normalizeSizePolicy(policy: StrategyMetadataSizePolicy | null | undefined): SizePolicy | undefined {
  if (!policy || policy.mode !== "confidence") return undefined;
  const minMultiplier = definedNumber(policy.minMultiplier);
  const maxMultiplier = definedNumber(policy.maxMultiplier);
  if (minMultiplier === undefined || maxMultiplier === undefined) return undefined;
  const minConfidence = definedNumber(policy.minConfidence);
  const maxConfidence = definedNumber(policy.maxConfidence);
  return {
    mode: policy.mode,
    minMultiplier,
    maxMultiplier,
    ...(minConfidence === undefined ? {} : { minConfidence }),
    ...(maxConfidence === undefined ? {} : { maxConfidence })
  };
}

function normalizeDynamicStopLossPolicy(
  policy: StrategyMetadataDynamicStopLossPolicy | null | undefined
): DynamicStopLossPolicy | undefined {
  if (
    !policy ||
    (policy.mode !== "breakeven" && policy.mode !== "trail_prior_bar" && policy.mode !== "trail_hourly_pivot")
  ) return undefined;
  const bufferUnits = definedNumber(policy.bufferUnits);
  const triggerMultiple = definedNumber(policy.triggerMultiple);
  const lockMultiple = definedNumber(policy.lockMultiple);
  return {
    mode: policy.mode,
    ...(bufferUnits === undefined ? {} : { bufferUnits }),
    ...(triggerMultiple === undefined ? {} : { triggerMultiple }),
    ...(lockMultiple === undefined ? {} : { lockMultiple })
  };
}

function normalizeDynamicTakeProfitPolicy(
  policy: StrategyMetadataDynamicTakeProfitPolicy | null | undefined
): DynamicTakeProfitPolicy | undefined {
  if (
    !policy ||
    (policy.mode !== "trail_prior_bar" && policy.mode !== "risk_multiple" && policy.mode !== "trail_hourly_extreme")
  ) {
    return undefined;
  }
  const bufferUnits = definedNumber(policy.bufferUnits);
  const rewardMultiple = definedNumber(policy.rewardMultiple);
  return {
    mode: policy.mode,
    ...(bufferUnits === undefined ? {} : { bufferUnits }),
    ...(rewardMultiple === undefined ? {} : { rewardMultiple })
  };
}

function numericArray(values: number[] | null | undefined): number[] | undefined {
  if (!Array.isArray(values) || values.some((value) => !Number.isFinite(value))) return undefined;
  return values;
}

function numericMatrix(values: number[][] | null | undefined): number[][] | undefined {
  if (!Array.isArray(values)) return undefined;
  return values.every((row) => Array.isArray(row) && row.every((value) => Number.isFinite(value))) ? values : undefined;
}

function normalizeEchoModel(model: StrategyMetadataEchoNeuralModel | null | undefined): EchoNeuralModel | undefined {
  if (!model || model.kind !== "neural") return undefined;
  const threshold = definedNumber(model.threshold);
  const featureMeans = numericArray(model.featureMeans);
  const featureScales = numericArray(model.featureScales);
  const hiddenWeights = numericMatrix(model.hiddenWeights);
  const hiddenBias = numericArray(model.hiddenBias);
  const outputWeights = numericArray(model.outputWeights);
  const outputBias = definedNumber(model.outputBias);
  if (
    threshold === undefined ||
    !featureMeans ||
    !featureScales ||
    !hiddenWeights ||
    !hiddenBias ||
    !outputWeights ||
    outputBias === undefined
  ) {
    return undefined;
  }
  return {
    kind: model.kind,
    threshold,
    featureNames: Array.isArray(model.featureNames) ? model.featureNames : undefined,
    featureMeans,
    featureScales,
    hiddenWeights,
    hiddenBias,
    outputWeights,
    outputBias
  };
}

export function runtimeDefaultsFromMetadata(metadata: StrategyMetadataDefaults): StrategyRuntimeDefaults {
  return {
    variantId: metadata.variantId ?? undefined,
    source: metadata.source ?? undefined,
    signalAtrMult: definedNumber(metadata.signalAtrMult),
    recentSignalLookback: definedNumber(metadata.recentSignalLookback),
    absCloseEma200AtrMax: definedNumber(metadata.absCloseEma200AtrMax),
    tradeRsiMin: definedNumber(metadata.tradeRsiMin),
    tradeRsiMax: definedNumber(metadata.tradeRsiMax),
    ictRiskReward: definedNumber(metadata.ictRiskReward),
    minimumRiskReward: definedNumber(metadata.minimumRiskReward),
    selectedRiskReward: definedNumber(metadata.selectedRiskReward),
    tpUnits: definedNumber(metadata.tpUnits),
    slUnits: definedNumber(metadata.slUnits),
    sizeMultiplier: definedNumber(metadata.sizeMultiplier),
    stopLossPolicy: normalizeStopLossPolicy(metadata.stopLossPolicy),
    takeProfitPolicy: normalizeTakeProfitPolicy(metadata.takeProfitPolicy),
    sizePolicy: normalizeSizePolicy(metadata.sizePolicy),
    dynamicStopLossPolicy: normalizeDynamicStopLossPolicy(metadata.dynamicStopLossPolicy),
    dynamicTakeProfitPolicy: normalizeDynamicTakeProfitPolicy(metadata.dynamicTakeProfitPolicy),
    echoModel: normalizeEchoModel(metadata.echoModel),
    oneTradePerDay: definedBoolean(metadata.oneTradePerDay),
    costUnits: definedNumber(metadata.costUnits),
    invertSignal: definedBoolean(metadata.invertSignal)
  };
}

export function createStrategyDefinition(definition: StrategyDefinition): StrategyDefinition {
  return definition;
}
