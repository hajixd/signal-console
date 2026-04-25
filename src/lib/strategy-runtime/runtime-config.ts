export type StrategySession = "asia" | "london" | "pre_ny" | "ny" | "all";
export type StrategyTrend = "all" | "ema" | "both" | "long_only" | "short_only";

export type SignalConsoleStrategyConfig = {
  session: StrategySession;
  rangeMinutes: number;
  entryMinutes: number;
  rr: number;
  slAtr: number;
  tpAtr: number;
  threshold: number;
  adxMax?: number;
  adxMin?: number;
  rsi2Max?: number;
  trend: StrategyTrend;
  maxBars: number;
  oneTradePerDay: boolean;
};

const DEFAULT_CONFIG: SignalConsoleStrategyConfig = {
  session: "ny",
  rangeMinutes: 15,
  entryMinutes: 150,
  rr: 1.5,
  slAtr: 1,
  tpAtr: 1.5,
  threshold: 0.05,
  trend: "all",
  maxBars: 24,
  oneTradePerDay: true
};

function isStrategySession(value: string): value is StrategySession {
  return value === "asia" || value === "london" || value === "pre_ny" || value === "ny" || value === "all";
}

function isStrategyTrend(value: string): value is StrategyTrend {
  return value === "all" || value === "ema" || value === "both" || value === "long_only" || value === "short_only";
}

function optionalNumber(value: string | undefined): number | undefined {
  if (!value || value === "none") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function strategyRuntimeConfig(variantId: string | undefined): SignalConsoleStrategyConfig {
  if (!variantId) return DEFAULT_CONFIG;

  const parts = variantId.split("|").filter(Boolean);
  if (!parts.length) return DEFAULT_CONFIG;

  let cursor = 1;
  let session: StrategySession = DEFAULT_CONFIG.session;
  if (parts[cursor] && !parts[cursor]!.includes("=") && isStrategySession(parts[cursor]!)) {
    session = parts[cursor]! as StrategySession;
    cursor += 1;
  }

  const config: SignalConsoleStrategyConfig = {
    ...DEFAULT_CONFIG,
    session
  };

  for (; cursor < parts.length; cursor += 1) {
    const [key, rawValue] = parts[cursor]!.split("=", 2);
    const value = rawValue ?? "";
    if (key === "range") config.rangeMinutes = optionalNumber(value) ?? config.rangeMinutes;
    if (key === "entry") config.entryMinutes = optionalNumber(value) ?? config.entryMinutes;
    if (key === "rr") config.rr = optionalNumber(value) ?? config.rr;
    if (key === "sl_atr") config.slAtr = optionalNumber(value) ?? config.slAtr;
    if (key === "tp_atr") config.tpAtr = optionalNumber(value) ?? config.tpAtr;
    if (key === "threshold") config.threshold = optionalNumber(value) ?? config.threshold;
    if (key === "adx_max") config.adxMax = optionalNumber(value);
    if (key === "adx_min") config.adxMin = optionalNumber(value);
    if (key === "rsi2") config.rsi2Max = optionalNumber(value);
    if (key === "trend" && isStrategyTrend(value)) config.trend = value;
    if (key === "max_bars") config.maxBars = optionalNumber(value) ?? config.maxBars;
    if (key === "one_trade") config.oneTradePerDay = value !== "0";
  }

  return config;
}
