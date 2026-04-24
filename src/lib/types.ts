export type Side = "long" | "short";
export type Market = "futures" | "forex" | "gold_spot";
export type StrategyPhase = string;

export type Bar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type StrategyRule = {
  key: string;
  logicalKey: string;
  datasetId?: string;
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
  entryMode: string;
  market: string;
  symbol: string;
  strategy: string;
  side: Side;
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  tpUnits: number;
  slUnits: number;
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
  generated: TradeAlert[];
  skippedDuplicates: string[];
  skippedRisk: Array<{ id: string; symbol: string; reason: string }>;
  errors: Array<{ symbol: string; message: string }>;
};
