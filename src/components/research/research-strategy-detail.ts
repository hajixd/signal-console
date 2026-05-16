export type ResearchStrategyLike = {
  assetKey?: string;
  engine?: string;
  hypothesis?: string;
  ideaReport?: {
    entry?: string;
    entryConditions?: string;
    exit?: string;
    exitConditions?: string;
    stop?: string;
    stopLossPlan?: string;
    takeProfitPlan?: string;
    target?: string;
    useLimitOrder?: string;
    limitOrderPlan?: string;
  };
  market?: string;
  params?: Record<string, unknown>;
  sourceUrls?: string[];
  strategyId?: string;
  symbol?: string;
  thresholds?: {
    minProfitFactor?: number;
    minTrades?: number;
  };
  title?: string;
};

function numberParam(params: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = params?.[key];
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function ruleCode(strategy: ResearchStrategyLike): Record<string, unknown> | undefined {
  const params = strategy.params;
  const raw = params?.ruleCode;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
}

export function formatMinute(value: number | undefined): string {
  if (value === undefined) return "time not specified";
  const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60).toString().padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

export function strategyEntryConditions(strategy: ResearchStrategyLike): string {
  const report = strategy.ideaReport;
  if (report?.entryConditions || report?.entry) return report.entryConditions ?? report.entry ?? "";

  const params = strategy.params;
  const code = ruleCode(strategy);
  if (code) {
    return [
      `Long condition: ${String(code.longWhen ?? "not provided")}.`,
      `Short condition: ${String(code.shortWhen ?? "not provided")}.`,
      `Session window: ${formatMinute(numberParam(code, "sessionStartMinute"))} to ${formatMinute(numberParam(code, "sessionEndMinute"))}.`
    ].join(" ");
  }

  if (strategy.engine === "range_break") {
    return [
      `Build the reference range from ${formatMinute(numberParam(params, "rangeStartMinute"))} to ${formatMinute(numberParam(params, "rangeEndMinute"))}.`,
      `Watch for a ${stringParam(params, "direction") ?? "breakout/fade"} trigger from ${formatMinute(numberParam(params, "breakStartMinute"))} to ${formatMinute(numberParam(params, "breakEndMinute"))}.`
    ].join(" ");
  }

  if (strategy.engine === "open_gap") {
    return `Enter at ${formatMinute(numberParam(params, "entryMinute"))} when the opening gap qualifies, then trade ${stringParam(params, "direction") ?? "fade/continue"} relative to the gap.`;
  }

  if (strategy.engine === "overnight_bias") {
    return `Enter near ${formatMinute(numberParam(params, "entryMinute"))} in the configured overnight side after the close-to-open bias condition is present.`;
  }

  if (strategy.engine === "daily_tsmom") {
    return `Enter at ${formatMinute(numberParam(params, "entryMinute"))} when the daily lookback signal confirms ${stringParam(params, "direction") ?? "momentum/reversal"}.`;
  }

  return [
    `Use the ${strategy.engine ?? "configured"} engine on ${strategy.symbol ?? strategy.assetKey ?? "the selected asset"}.`,
    `Entry minute: ${formatMinute(numberParam(params, "entryMinute"))}.`,
    `Direction: ${stringParam(params, "direction") ?? "engine default"}.`
  ].join(" ");
}

export function strategyExitConditions(strategy: ResearchStrategyLike): string {
  const report = strategy.ideaReport;
  if (report?.exitConditions || report?.exit) return report.exitConditions ?? report.exit ?? "";

  const params = strategy.params;
  const code = ruleCode(strategy);
  if (code) {
    return [
      `Exit at ${formatMinute(numberParam(code, "exitMinute"))}, on max bars ${numberParam(code, "maxBars") ?? "not specified"}, or when stop/target logic resolves.`,
      `One trade per day: ${code.oneTradePerDay === false ? "no" : "yes"}.`
    ].join(" ");
  }

  const exitMinute = numberParam(params, "exitMinute") ?? numberParam(params, "forcedExitMinute");
  return `Exit at ${formatMinute(exitMinute)} or when the engine-level stop/target condition completes.`;
}

export function strategyTakeProfitPlan(strategy: ResearchStrategyLike): string {
  const report = strategy.ideaReport;
  if (report?.takeProfitPlan || report?.target) return report.takeProfitPlan ?? report.target ?? "";

  const params = strategy.params;
  const code = ruleCode(strategy);
  const riskReward = numberParam(code, "riskReward") ?? numberParam(params, "riskReward");
  const explicit = typeof params?.takeProfit === "string" ? params.takeProfit : "";
  if (explicit) return explicit;
  if (riskReward !== undefined) return `Use a ${riskReward.toFixed(2)}R target unless the time/session exit arrives first.`;
  return "Take profit is determined by the engine default target or the configured time exit.";
}

export function strategyStopLossPlan(strategy: ResearchStrategyLike): string {
  const report = strategy.ideaReport;
  if (report?.stopLossPlan || report?.stop) return report.stopLossPlan ?? report.stop ?? "";

  const params = strategy.params;
  const code = ruleCode(strategy);
  const riskAtr = numberParam(code, "riskAtrMult");
  const explicit = typeof params?.stopLoss === "string" ? params.stopLoss : "";
  if (explicit) return explicit;
  if (riskAtr !== undefined) return `Use an ATR-based risk distance of ${riskAtr.toFixed(2)}x ATR from entry.`;
  return "Stop loss is determined by the engine default invalidation or range/structure risk.";
}

export function strategyLimitOrderPlan(strategy: ResearchStrategyLike): string {
  const report = strategy.ideaReport;
  if (report?.limitOrderPlan || report?.useLimitOrder) {
    return [report.useLimitOrder, report.limitOrderPlan].filter(Boolean).join(" - ");
  }
  return "No limit-order rule is stored for this spec; treat the current research backtest as a market-entry test.";
}

export function compactId(value: string | undefined) {
  if (!value) return "n/a";
  if (value.length <= 42) return value;
  return `${value.slice(0, 26)}...${value.slice(-8)}`;
}

export function strategyJson(strategy: ResearchStrategyLike) {
  return JSON.stringify(strategy, null, 2);
}
