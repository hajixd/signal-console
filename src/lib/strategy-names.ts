import { assetForKey, assetForSymbol, assetLookupSymbolForSymbol, type AssetDefinition } from "@/lib/assets";

type StrategyNameInput = {
  assetKey?: string;
  label?: string;
  phase?: string;
  symbol?: string;
  timeframeLabel?: string;
  timeframes?: string[];
  variantId?: string;
};

const ACRONYMS = new Set(["atr", "ema", "ict", "ny", "rth", "tsmom", "usd", "eur", "gbp", "jpy", "aud", "nzd", "cad", "chf"]);

const FAMILY_LABELS: Record<string, string> = {
  asia_range_london_breakout: "Asia Range London Breakout",
  daily_tsmom_next_overnight: "Daily TSMOM Overnight",
  daily_tsmom_next_rth: "Daily TSMOM RTH",
  london_first30_last30_momentum: "London First30 US Close Momentum",
  london_first30_last30_reversal: "London First30 US Close Reversal",
  london_first30_ny_open_momentum: "London First30 NY Momentum",
  london_first30_ny_open_reversal: "London First30 NY Reversal",
  ny_open_gap_fade: "NY Open Gap Fade",
  ny_open_gap_follow: "NY Open Gap Follow",
  overnight_close_to_open_bias: "Overnight Close/Open Bias",
  us_first30_last30_momentum: "US First30 Close Momentum",
  us_first30_last30_reversal: "US First30 Close Reversal",
  us_first30_midday_momentum: "US First30 Midday Momentum",
  us_first30_midday_reversal: "US First30 Midday Reversal"
};

const PHASE_LABELS: Record<string, string> = {
  competition_session_edge: "Session Edge",
  ict_sweep_fvg: "ICT Sweep FVG",
  ict_turtle_soup: "ICT Turtle Soup",
  moving_average_touch: "MA Touch",
  ny_sweep_playbook: "NY Sweep",
  round_number_rejection: "Round Number Rejection",
  support_resistance_retest: "S/R Retest",
  trendline_break: "Trendline Break",
  vwap_pullback: "VWAP Pullback"
};

function safeAssetForKey(key: string | undefined): AssetDefinition | undefined {
  if (!key) return undefined;
  try {
    return assetForKey(key);
  } catch {
    return undefined;
  }
}

function compactAssetLabel(input: StrategyNameInput): string {
  const asset = safeAssetForKey(input.assetKey) ?? (input.symbol ? assetForSymbol(input.symbol) : undefined);
  if (asset) return assetLookupSymbolForSymbol(asset.symbol);
  return input.symbol?.trim().toUpperCase() || "Strategy";
}

function titleize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (/^\d/.test(part)) return part;
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactSymbol(value: string | undefined): string | undefined {
  const compacted = value?.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return compacted || undefined;
}

function baseFamilyKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/_signalmonth_month_\d+$/, "")
    .replace(/_signalmonth$/, "")
    .replace(/_month_\d+$/, "")
    .replace(/_signalweekdayside$/, "")
    .replace(/_weekday_side_\d+_(?:long|short)$/, "");
}

function variantParts(variantId: string | undefined): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const segment of variantId?.split("|") ?? []) {
    const [key, ...rest] = segment.split("=");
    if (!key || !rest.length) continue;
    parts[key] = rest.join("=");
  }
  return parts;
}

function familyLabel(input: StrategyNameInput, parts: Record<string, string>): string {
  if (parts.family) {
    const baseKey = baseFamilyKey(parts.family);
    if (FAMILY_LABELS[baseKey]) return FAMILY_LABELS[baseKey];
    return titleize(baseKey);
  }
  if (input.phase && PHASE_LABELS[input.phase]) return PHASE_LABELS[input.phase];
  if (input.phase) return titleize(input.phase);
  return cleanupRawLabel(input.label);
}

function directionLabel(parts: Record<string, string>, family: string): string | undefined {
  const direction = (parts.side ?? parts.direction)?.toLowerCase();
  if (!direction) return undefined;
  if (direction === "same" || direction === "opposite") return undefined;
  const label = direction === "contrarian" || direction === "fade" ? "Mean Rev" : titleize(direction);
  return family.toLowerCase().includes(label.toLowerCase()) ? undefined : label;
}

function parameterLabel(parts: Record<string, string>, family: string): string | undefined {
  if (family.toLowerCase().includes("tsmom") && parts.lookback) return `${parts.lookback}D`;
  return undefined;
}

function timeframeLabel(input: StrategyNameInput, parts: Record<string, string>): string | undefined {
  const value = parts.tf || input.timeframes?.[0] || input.timeframeLabel?.split(",")[0]?.trim();
  return value && !value.includes(" ") ? value : undefined;
}

function cleanupRawLabel(label: string | undefined): string {
  if (!label) return "Live Signal";
  return label
    .replace(/^Competition\s+/i, "")
    .replace(/\bSignal(?:month|weekdayside)\b/gi, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\btrue\s+\d+R\b/gi, "")
    .replace(/\bcross-asset\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function conciseStrategyName(input: StrategyNameInput): string {
  const parts = variantParts(input.variantId);
  const asset = compactAssetLabel(input);
  const family = stripAssetPrefix(familyLabel(input, parts), input, asset);
  const direction = directionLabel(parts, family);
  const parameter = parameterLabel(parts, family);
  const timeframe = timeframeLabel(input, parts);
  return [asset, family, direction, parameter, timeframe].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function stripAssetPrefix(label: string, input: StrategyNameInput, asset: string): string {
  let next = label.trim();
  const symbol = compactSymbol(input.symbol);
  const candidates = [asset, input.symbol, symbol].filter((value): value is string => Boolean(value?.trim()));
  for (const candidate of candidates) {
    next = next.replace(new RegExp(`^${escapeRegex(candidate.trim())}\\b\\s*`, "i"), "").trim();
    const compactCandidate = compactSymbol(candidate);
    if (compactCandidate && compactSymbol(next)?.startsWith(compactCandidate)) {
      next = next.slice(compactCandidate.length).trim();
    }
  }
  return next || label;
}
