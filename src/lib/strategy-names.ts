import { KNOWN_TRADER_LABELS } from "./known-trader-strategies";

type StrategyNameInput = {
  symbol: string;
  phase: string;
  source?: string;
  variantId?: string;
  mlModelName?: string;
};

const MANUAL_STRATEGY_LABELS: Record<string, string> = {
  ...KNOWN_TRADER_LABELS
};

const ML_MODEL_LABELS: Record<string, string> = {
  extra_clf: "Extra Trees",
  gaussian_nb: "Gaussian Naive Bayes",
  gb_clf: "Gradient Boosting",
  hist_clf: "Histogram Gradient Boosting",
  knn_clf: "k-NN",
  logistic_clf: "Logistic Regression",
  sgd_logistic_clf: "SGD Logistic Regression",
  tree_clf: "Decision Tree",
  xgb_clf: "XGBoost"
};

const BENCHMARK_ML_MODEL_BY_KEY: Record<string, string> = {
  "CL:mean_reversion": "SGD Logistic Regression",
  "CL:momentum": "Gradient Boosting",
  "ES:mean_reversion": "k-NN",
  "ES:momentum": "Logistic Regression",
  "GC:mean_reversion": "k-NN",
  "GC:momentum": "Gaussian Naive Bayes",
  "HG:mean_reversion": "SGD Logistic Regression",
  "HG:momentum": "Extra Trees",
  "NQ:mean_reversion": "Decision Tree",
  "NQ:momentum": "Extra Trees",
  "RTY:mean_reversion": "Decision Tree",
  "RTY:momentum": "k-NN",
  "SI:mean_reversion": "SGD Logistic Regression",
  "SI:momentum": "Logistic Regression",
  "YM:mean_reversion": "SGD Logistic Regression",
  "YM:momentum": "Histogram Gradient Boosting"
};

const UPPERCASE_PARTS = new Set(["adx", "bb", "ema", "fvg", "ict", "ml", "ny", "orb", "rsi", "sr", "tjr", "vwap"]);

const SESSION_LABELS: Record<string, string> = {
  all: "All",
  asia: "Asia",
  london: "LDN",
  ny: "NY",
  pre_ny: "Pre-NY"
};

function strategyNameKey(symbol: string, phase: string): string {
  return `${symbol}:${phase}`;
}

function formatPhasePart(part: string, uppercaseKnownParts: boolean): string {
  if (!part) return "";
  if (uppercaseKnownParts && UPPERCASE_PARTS.has(part)) return part.toUpperCase();
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function formatPhaseLabel(phase: string, uppercaseKnownParts: boolean): string {
  return phase
    .split("_")
    .filter(Boolean)
    .map((part) => formatPhasePart(part, uppercaseKnownParts))
    .join(" ");
}

function trimNumber(value: string | undefined): string | undefined {
  if (!value || value === "none") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return Number.isInteger(parsed) ? String(parsed) : String(parsed).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatTrendLabel(value: string | undefined): string | undefined {
  if (!value || value === "all" || value === "both") return undefined;
  if (value === "ema") return "EMA";
  if (value === "long_only") return "Long only";
  if (value === "short_only") return "Short only";
  return formatPhaseLabel(value, true);
}

function formatVariantDescriptor(variantId?: string): string | undefined {
  if (!variantId || variantId === "precision_sprint") return undefined;

  const parts = variantId.split("|").filter(Boolean);
  if (!parts.length) return undefined;

  let session: string | undefined;
  let lookback: string | undefined;
  let range: string | undefined;
  let entry: string | undefined;
  let rr: string | undefined;
  let tpAtr: string | undefined;
  let slAtr: string | undefined;
  let threshold: string | undefined;
  let trend: string | undefined;
  let maxBars: string | undefined;
  let oneTrade: string | undefined;
  let adxMin: string | undefined;
  let adxMax: string | undefined;
  let rsi2: string | undefined;

  for (const part of parts) {
    if (!part.includes("=")) {
      if (part in SESSION_LABELS) session = part;
      continue;
    }

    const [key, rawValue] = part.split("=", 2);
    const value = rawValue ?? "";
    if (key === "lookback") lookback = trimNumber(value);
    if (key === "range") range = trimNumber(value);
    if (key === "entry") entry = trimNumber(value);
    if (key === "rr") rr = trimNumber(value);
    if (key === "tp_atr") tpAtr = trimNumber(value);
    if (key === "sl_atr") slAtr = trimNumber(value);
    if (key === "threshold") threshold = trimNumber(value);
    if (key === "trend") trend = value;
    if (key === "max_bars") maxBars = trimNumber(value);
    if (key === "one_trade" || key === "one_trade_per_day") oneTrade = value;
    if (key === "adx_min") adxMin = trimNumber(value);
    if (key === "adx_max") adxMax = trimNumber(value);
    if (key === "rsi2" || key === "rsi2_max") rsi2 = trimNumber(value);
  }

  const tokens: string[] = [];
  if (session) tokens.push(SESSION_LABELS[session] ?? session);
  if (lookback) tokens.push(`L${lookback}`);
  else if (range) tokens.push(`R${range}`);
  if (entry) tokens.push(`E${entry}`);
  if (rr) tokens.push(`RR${rr}`);
  if (tpAtr) tokens.push(`TP${tpAtr} ATR`);
  if (slAtr) tokens.push(`SL${slAtr} ATR`);
  if (threshold && threshold !== "0") tokens.push(`Th${threshold}`);

  const trendLabel = formatTrendLabel(trend);
  if (trendLabel) tokens.push(trendLabel);
  if (maxBars) tokens.push(`${maxBars}b`);
  if (oneTrade && oneTrade !== "0") tokens.push("1/day");
  if (adxMin) tokens.push(`ADX>=${adxMin}`);
  if (adxMax) tokens.push(`ADX<=${adxMax}`);
  if (rsi2) tokens.push(`RSI2 ${rsi2}`);

  const uniqueTokens = tokens.filter((token, index) => tokens.indexOf(token) === index);
  return uniqueTokens.length ? uniqueTokens.slice(0, 5).join(", ") : undefined;
}

function fallbackPrefix(source?: string, variantId?: string, mlModelName?: string): string | undefined {
  if (mlModelName) return mlModelName;

  const combined = `${source ?? ""}|${variantId ?? ""}`.toLowerCase();
  if (combined.includes("precision_sprint")) return "Precision Sprint";
  if (combined.includes("reddit")) return "Reddit";
  if (combined.includes("deep_online")) return "Research-Based";
  if (combined.includes("rule_based") || (!source && !variantId)) return "Rule-Based";
  return undefined;
}

function legacyMlAlias(symbol: string, phase: string, source?: string, variantId?: string): string | undefined {
  const combined = `${source ?? ""}|${variantId ?? ""}`.toLowerCase();
  if (!combined.includes("precision_sprint")) return undefined;
  return `${symbol} ML-Selected ${formatPhaseLabel(phase, true)}`;
}

function baseStrategyDisplayLabel({ symbol, phase, source, variantId, mlModelName }: StrategyNameInput): string {
  const manual = MANUAL_STRATEGY_LABELS[strategyNameKey(symbol, phase)];
  if (manual) return manual;

  const prefix = fallbackPrefix(source, variantId, mlModelName);
  const phaseLabel = formatPhaseLabel(phase, true);
  if (!prefix) return `${symbol} ${phaseLabel}`;

  const normalizedPhase = phaseLabel.toLowerCase();
  const normalizedPrefix = prefix.toLowerCase();
  if (normalizedPhase.startsWith(normalizedPrefix)) return `${symbol} ${phaseLabel}`;
  return `${symbol} ${prefix} ${phaseLabel}`;
}

export function legacyLiveStrategyLabel(symbol: string, phase: string): string {
  return `${symbol} ${formatPhaseLabel(phase, true)}`;
}

export function legacyBacktestStrategyLabel(symbol: string, phase: string): string {
  return `${symbol} ${formatPhaseLabel(phase, false)}`;
}

export function benchmarkMlModelName(symbol: string, phase: string): string | undefined {
  return BENCHMARK_ML_MODEL_BY_KEY[strategyNameKey(symbol, phase)];
}

export function mlModelDisplayName(modelName: string): string {
  return ML_MODEL_LABELS[modelName] ?? modelName;
}

export function strategyDisplayLabel(input: StrategyNameInput): string {
  const baseLabel = baseStrategyDisplayLabel(input);
  const descriptor = formatVariantDescriptor(input.variantId);
  return descriptor ? `${baseLabel} [${descriptor}]` : baseLabel;
}

export function strategyLabelAliases(input: StrategyNameInput): string[] {
  const aliases = [
    strategyDisplayLabel(input),
    baseStrategyDisplayLabel(input),
    legacyMlAlias(input.symbol, input.phase, input.source, input.variantId),
    legacyLiveStrategyLabel(input.symbol, input.phase),
    legacyBacktestStrategyLabel(input.symbol, input.phase)
  ].filter((value): value is string => typeof value === "string");
  const seen = new Set<string>();
  return aliases.filter((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
