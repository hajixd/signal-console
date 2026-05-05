import type { Market } from "./assets";

export type Side = "long" | "short";
export type StrategyPhase = string;
export type EntryType = "market" | "limit";
export type BacktestPriceMode = "fixed" | "custom";
export type BacktestSizeMode = "auto" | "custom";

export type StopLossPolicy = {
  mode: "signal_extreme" | "prior_day_extreme";
  bufferUnits?: number;
};

export type TakeProfitPolicy = {
  mode: "risk_multiple" | "signal_extreme" | "prior_day_extreme";
  bufferUnits?: number;
  rewardMultiple?: number;
};

export type SizePolicy = {
  mode: "confidence";
  minMultiplier: number;
  maxMultiplier: number;
  minConfidence?: number;
  maxConfidence?: number;
};

export type DynamicStopLossPolicy = {
  mode: "trail_prior_bar" | "trail_hourly_pivot";
  bufferUnits?: number;
};

export type DynamicTakeProfitPolicy = {
  mode: "trail_prior_bar" | "risk_multiple" | "trail_hourly_extreme";
  bufferUnits?: number;
  rewardMultiple?: number;
};

export type Bar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type StrategyParameters = {
  signalAtrMult: number;
  recentSignalLookback: number;
  absCloseEma200AtrMax: number;
  tpUnits: number;
  slUnits: number;
};

export type StrategyRule = {
  key: string;
  logicalKey: string;
  datasetId?: string;
  strategyId: string;
  assetKey: string;
  market: Market;
  symbol: string;
  databentoSymbol?: string;
  phase: StrategyPhase;
  label: string;
  variantId?: string;
  source?: string;
  signalAtrMult?: number;
  recentSignalLookback?: number;
  absCloseEma200AtrMax?: number;
  tradeRsiMin?: number;
  tradeRsiMax?: number;
  squeezeLookback?: number;
  squeezeThreshold?: number;
  ictRiskReward?: number;
  tpUnits: number;
  slUnits: number;
  tickSize: number;
  unitLabel: string;
  sizeMultiplier?: number;
  stopLossPolicy?: StopLossPolicy;
  takeProfitPolicy?: TakeProfitPolicy;
  sizePolicy?: SizePolicy;
  dynamicStopLossPolicy?: DynamicStopLossPolicy;
  dynamicTakeProfitPolicy?: DynamicTakeProfitPolicy;
  oneTradePerDay?: boolean;
  costUnits?: number;
  estimatedWinRatePct: number;
  liveProfitFactor: number;
  invertSignal?: boolean;
};

export type TradeAlert = {
  id: string;
  createdAt: string;
  signalTime: string;
  strategyKey?: string;
  logicalStrategyKey?: string;
  datasetId?: string;
  strategyId?: string;
  assetKey?: string;
  entryMode: string;
  entryType?: EntryType;
  market: string;
  symbol: string;
  strategy: string;
  side: Side;
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  tpUnits: number;
  slUnits: number;
  tpMode?: BacktestPriceMode;
  slMode?: BacktestPriceMode;
  sizeMode?: BacktestSizeMode;
  unitLabel: string;
  sizeMultiplier?: number;
  estimatedWinRatePct: number;
  liveProfitFactor: number;
  status: "alerted" | "skipped";
  telegramStatus: "sent" | "skipped" | "failed";
  telegramError?: string;
  notes?: string;
};

export type CronResult = {
  checkedAt: string;
  dataRefresh?: {
    assets: Array<{
      assetKey: string;
      dataFile: string;
      firstBarAt?: string;
      lastBarAt?: string;
      rows: number;
      symbol: string;
      timeframes: string[];
      updatedAt: string;
      uploadedFiles: number;
    }>;
    errors: Array<{ assetKey: string; message: string; symbol: string }>;
    refreshedAt: string;
    uploadedFiles: number;
  };
  generated: TradeAlert[];
  skippedDuplicates: string[];
  skippedRisk: Array<{ id: string; symbol: string; reason: string }>;
  errors: Array<{ symbol: string; message: string }>;
};
