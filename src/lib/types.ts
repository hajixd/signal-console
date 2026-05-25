import type { Market } from "./assets";

export type Side = "long" | "short";
export type StrategyPhase = string;
export type EntryType = "market" | "limit";
export type BacktestPriceMode = "fixed" | "custom";
export type BacktestSizeMode = "auto" | "custom";

export type AutoTradeOrderSummary = {
  accountBalance?: number;
  accountId: number;
  accountName?: string;
  contractId?: string;
  contractName?: string;
  customTag?: string;
  error?: string;
  orderId?: number;
  providerId?: string;
  providerName?: string;
  size?: number;
  status: "dry_run" | "failed" | "placed" | "skipped";
};

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

export type CustomScaleRange = {
  riskCeiling?: string;
  riskFloor?: string;
  targetCeiling?: string;
  targetFloor?: string;
};

export type EchoNeuralModel = {
  kind: "neural";
  threshold: number;
  featureNames?: string[];
  featureMeans: number[];
  featureScales: number[];
  hiddenWeights: number[][];
  hiddenBias: number[];
  outputWeights: number[];
  outputBias: number;
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

export type NotificationStatus = "sent" | "skipped" | "failed";

export type TradeManagementEvent = {
  autoTradeError?: string;
  autoTradeOrders?: AutoTradeOrderSummary[];
  autoTradeStatus?: "disabled" | "dry_run" | "failed" | "placed" | "skipped";
  createdAt: string;
  discordError?: string;
  discordStatus?: NotificationStatus;
  entryPrice?: number;
  id: string;
  label?: string;
  previousPrice?: number;
  price: number;
  reason?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  telegramError?: string;
  telegramStatus?: NotificationStatus;
  time: string;
  type: "edit_tp" | "edit_sl" | "edit_limit";
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
  sizeScale?: number;
  sizeMultiplier?: number;
  customScaleRange?: CustomScaleRange;
  stopLossPolicy?: StopLossPolicy;
  takeProfitPolicy?: TakeProfitPolicy;
  sizePolicy?: SizePolicy;
  dynamicStopLossPolicy?: DynamicStopLossPolicy;
  dynamicTakeProfitPolicy?: DynamicTakeProfitPolicy;
  echoModel?: EchoNeuralModel;
  oneTradePerDay?: boolean;
  costUnits?: number;
  estimatedWinRatePct: number;
  liveProfitFactor: number;
  invertSignal?: boolean;
};

export type TradeAlert = {
  autoTradeAccountId?: number;
  autoTradeAccountName?: string;
  autoTradeCheckedAt?: string;
  autoTradeContractId?: string;
  autoTradeContractName?: string;
  autoTradeCustomTag?: string;
  autoTradeError?: string;
  autoTradeOrderId?: number;
  autoTradeOrders?: AutoTradeOrderSummary[];
  autoTradeProviderId?: string;
  autoTradeProviderName?: string;
  autoTradeStatus?: "disabled" | "dry_run" | "failed" | "placed" | "skipped";
  entryOrderSizeMultiplier?: number;
  id: string;
  orderLeg?: "entry" | "limit";
  splitOrderTotalSizeMultiplier?: number;
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
  sizeScale?: number;
  sizeMultiplier?: number;
  estimatedWinRatePct: number;
  liveProfitFactor: number;
  limitOrderAutoTradeCheckedAt?: string;
  limitOrderAutoTradeContractId?: string;
  limitOrderAutoTradeContractName?: string;
  limitOrderAutoTradeCustomTag?: string;
  limitOrderAutoTradeError?: string;
  limitOrderAutoTradeOrderId?: number;
  limitOrderAutoTradeOrders?: AutoTradeOrderSummary[];
  limitOrderAutoTradeProviderId?: string;
  limitOrderAutoTradeProviderName?: string;
  limitOrderAutoTradeStatus?: "disabled" | "dry_run" | "failed" | "placed" | "skipped";
  limitOrderDiscordError?: string;
  limitOrderDiscordStatus?: NotificationStatus;
  limitOrderError?: string;
  limitOrderPrice?: number;
  limitOrderSizeMultiplier?: number;
  limitOrderTelegramError?: string;
  limitOrderTelegramStatus?: NotificationStatus;
  lifecycleNotifiedAt?: string;
  lifecyclePnlDollars?: number;
  lifecyclePrice?: number;
  lifecycleRMultiple?: number;
  lifecycleStatus?: "open" | "take_profit" | "stop_loss" | "max_bars";
  lifecycleTime?: string;
  managementEvents?: TradeManagementEvent[];
  maxBars?: number;
  status: "alerted" | "skipped";
  discordError?: string;
  discordLifecycleError?: string;
  discordLifecycleStatus?: NotificationStatus;
  discordStatus?: NotificationStatus;
  telegramStatus: NotificationStatus;
  telegramLifecycleError?: string;
  telegramLifecycleStatus?: NotificationStatus;
  telegramError?: string;
  notes?: string;
};

export type CronResult = {
  assetTimings?: Array<{
    assetKey: string;
    durationMs: number;
    rules: number;
    symbol: string;
  }>;
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
  signalScan?: {
    candidates: number;
    dispatchConcurrency?: number;
    lookbackMinutes: number;
    maxActionableAgeMinutes: number;
    maxBars: number;
    rawSignals: number;
    scanConcurrency?: number;
    staleSignals: number;
  };
  generated: TradeAlert[];
  skippedData?: Array<{ assetKey: string; reason: string; symbol: string }>;
  skippedDuplicates: string[];
  skippedRisk: Array<{ id: string; symbol: string; reason: string }>;
  errors: Array<{ symbol: string; message: string }>;
};
