import Link from "next/link";
import ChallengeReplay from "@/components/challenge/challenge-replay";
import AutoTradeAccountGate from "@/components/auto-trading/auto-trade-account-gate";
import AutoTradeAccountModeSwitch from "@/components/auto-trading/auto-trade-account-mode-switch";
import AutoTradingConnectionDrawer from "@/components/auto-trading/auto-trading-connection-drawer";
import SelectedStrategyStats from "@/components/strategies/selected-strategy-stats";
import StrategySelector from "@/components/strategies/strategy-selector";
import EditableTradeHistory from "@/components/trades/editable-trade-history";
import { type TradeHistoryRow } from "@/components/trades/trade-history";
import { type TradeChartTimeframe } from "@/components/trades/trade-price-chart";
import AutoRefresh from "@/components/ui/auto-refresh";
import LocalDateTime from "@/components/ui/local-date-time";
import MarketSwitchTabs from "@/components/ui/market-switch-tabs";
import TestAlertButton from "@/components/ui/test-alert-button";
import ThemeToggle from "@/components/ui/theme-toggle";
import {
  syncActiveMarket,
  syncChallengeRulesForMarket,
  syncCustomScaleRange,
  syncLiveSelection,
  syncStrategyEdits,
  syncTheme
} from "@/app/live-selection-actions";
import { sendTestTelegramAlert } from "@/app/telegram-actions";
import {
  aggregateBacktest,
  getBacktestCatalogFreshness,
  getBacktestStats,
  getBacktestTrades,
  getStrategyCatalog,
  type BacktestPriceMode,
  type BacktestSizeMode,
  type BacktestStat,
  type BacktestTrade
} from "@/lib/backtest";
import { DEFAULT_CHALLENGE_RULES, type ChallengeRules } from "@/lib/challenge";
import { dollarPerUnit, instrumentSizeLabel, instrumentUnitLabel, recommendedSizeMultiplier } from "@/lib/instruments";
import { defaultDatasetStatus, getDatasetStatus, getLiveConfig, type DatasetStatus, type LiveConfig } from "@/lib/live-config";
import { allRules } from "@/lib/live-signals";
import { projectAssetMode } from "@/lib/project-assets";
import { getTrades, storageMode } from "@/lib/storage";
import { telegramGroupInviteLink } from "@/lib/telegram";
import { topstepSessionKey } from "@/lib/topstep";
import type { TradeAlert, TradeManagementEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
const DEFAULT_SELECTED_STRATEGY_COUNT = 1;
const TRADE_CHART_TIMEFRAME_VALUES = new Set<TradeChartTimeframe>(["1m", "5m", "15m", "30m", "45m", "1h", "4h", "1d"]);
const HISTORY_VISIBLE_TRADE_LIMIT = 500;
const EMPTY_LIVE_CONFIG: LiveConfig = {
  customScaleRanges: {},
  dashboardSettings: {},
  dashboardSelectedDatasetIds: [],
  enabledDatasetIds: [],
  strategyEdits: {}
};

type HomeProps = {
  searchParams?: Promise<{
    market?: string;
    strategies?: string;
    accountSize?: string;
    profitTarget?: string;
    maxLoss?: string;
    dailyLoss?: string;
    dailyLock?: string;
    dailyStop?: string;
  }>;
};

type MarketTabKey = "forex" | "futures";

const MARKET_TABS: Array<{ key: MarketTabKey; label: string }> = [
  { key: "forex", label: "Forex" },
  { key: "futures", label: "Futures" }
];

type StrategyOption = {
  assetKey: string;
  key: string;
  label: string;
  aliases: string[];
  logicalKeys: string[];
  logicalKey: string;
  datasetId: string;
  timeframeLabel: string;
  symbol: string;
  phase: string;
  market?: string;
  source?: string;
  variantId?: string;
  winRatePct: number;
  profitFactor: number;
  trades: number;
  tradesPerWeek: number;
  tpUnits: number;
  slUnits: number;
  unitLabel: string;
  dollarPerUnit: number;
  sizeMultiplier: number;
  targetDollars: number;
  riskDollars: number;
  riskRewardRatio?: number;
  sizeLabel: string;
  tpMode?: BacktestPriceMode;
  slMode?: BacktestPriceMode;
  sizeMode?: BacktestSizeMode;
  rrrMode?: BacktestPriceMode;
  liveSupported: boolean;
  stat?: BacktestStat;
};

type DataValidityTone = "good" | "warning" | "bad";

type DataValidityIssue = {
  count: number;
  label: string;
  tone: Exclude<DataValidityTone, "good">;
};

type DataValidityResult = {
  detailTitle: string;
  issues: DataValidityIssue[];
  label: string;
  summary: string;
  tone: DataValidityTone;
};

function fmtPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 5
  }).format(value);
}

function fmtDollarPrice(value: number): string {
  return `$${fmtPrice(value)}`;
}

function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return "inf";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function latestIsoTime(values: Array<number | string | null | undefined>): string | undefined {
  const latest = Math.max(
    ...values
      .map((value) => {
        if (value === undefined || value === null || value === "") return Number.NaN;
        return typeof value === "number" ? value : Date.parse(value);
      })
      .filter(Number.isFinite)
  );

  return Number.isFinite(latest) ? new Date(latest).toISOString() : undefined;
}

function latestLiveTradeAt(trades: TradeAlert[]): string | undefined {
  return latestIsoTime(trades.flatMap((trade) => [trade.lifecycleTime, trade.signalTime]));
}

function latestDatasetCoverageAt(datasetStatus: DatasetStatus | null | undefined): string | undefined {
  return latestIsoTime(Object.values(datasetStatus?.assetCoverage ?? {}).map((coverage) => coverage.lastBarAt));
}

function dataValidityRank(tone: DataValidityTone): number {
  if (tone === "bad") return 2;
  if (tone === "warning") return 1;
  return 0;
}

function dataValidityIssueRank(issue: DataValidityIssue): number {
  return dataValidityRank(issue.tone);
}

function dataValidityClass(tone: DataValidityTone): string {
  if (tone === "bad") return "bad";
  if (tone === "warning") return "warning";
  return "good";
}

function fmtPct(value: number): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value)}%`;
}

function fmtMoney(value: number, signed = false): string {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0
  });
  const formatted = formatter.format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

function fmtTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function fmtDuration(startValue: string, endValue: string): string {
  const start = Date.parse(startValue);
  const end = Date.parse(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "--";

  let remainingMinutes = Math.round((end - start) / 60_000);
  const days = Math.floor(remainingMinutes / 1440);
  remainingMinutes -= days * 1440;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes - hours * 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function fmtExitReason(reason: string): string {
  const normalized = reason.toLowerCase();
  if (normalized === "tp") return "Take Profit";
  if (normalized === "sl") return "Stop Loss";
  if (reason === "signal") return "Exit Signal";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => {
      if (part === "tp") return "Take Profit";
      if (part === "sl") return "Stop Loss";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function sideClass(side: "long" | "short"): string {
  return side === "long" ? "sidePill sideLong" : "sidePill sideShort";
}

function sideLabel(side: "long" | "short"): string {
  return side === "long" ? "Buy" : "Sell";
}

function parseSelection(value: string | undefined, allKeys: string[], defaultKeys: string[]): string[] {
  if (value === "none") return [];
  const allowed = new Set(allKeys);
  if (!value) return defaultKeys.filter((key) => allowed.has(key));
  return value.split(",").filter((key) => allowed.has(key));
}

function tradeSourceTimeframe(trade: BacktestTrade): TradeChartTimeframe {
  return timeframeFromVariant(trade.variantId);
}

function timeframeFromVariant(variantId: string | undefined): TradeChartTimeframe {
  const timeframe = variantId?.split("|").find((part) => part.startsWith("tf="))?.slice(3);
  return timeframe && TRADE_CHART_TIMEFRAME_VALUES.has(timeframe as TradeChartTimeframe)
    ? (timeframe as TradeChartTimeframe)
    : "15m";
}

function tradeEntryType(trade: BacktestTrade): "market" | "limit" {
  const fingerprint = `${trade.phase} ${trade.variantId ?? ""} ${trade.modelName ?? ""} ${trade.label}`.toLowerCase();
  return fingerprint.includes("ict_sweep_fvg") || fingerprint.includes("ict sweep fvg") ? "limit" : "market";
}

function validMarketTab(value: string | undefined): MarketTabKey | undefined {
  if (value === "gold_spot") return "forex";
  return value === "forex" || value === "futures" ? value : undefined;
}

function parseMarketTab(value: string | undefined, fallback?: string): MarketTabKey {
  return validMarketTab(value) ?? validMarketTab(fallback) ?? "futures";
}

function strategyVisibleInMarket(strategyMarket: string | undefined, activeMarket: MarketTabKey): boolean {
  return normalizedDashboardMarket(strategyMarket) === activeMarket;
}

function normalizedDashboardMarket(value: string | undefined): MarketTabKey | undefined {
  if (value === "gold_spot") return "forex";
  return value === "forex" || value === "futures" ? value : undefined;
}

function marketLabel(value: string | undefined): string {
  const market = normalizedDashboardMarket(value) ?? value;
  if (!market) return "Market";
  return market
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function averageNumbers(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function assetLabel(symbols: string[]): string {
  if (symbols.length === 0) return "--";
  if (symbols.length === 1) return symbols[0]!;
  if (symbols.length <= 3) return symbols.join(", ");
  return `${symbols.slice(0, 3).join(", ")} +${symbols.length - 3}`;
}

function strategySizeLabel(symbols: string[], sizeMultiplier: number): string {
  const referenceSymbol = symbols[0];
  return referenceSymbol ? instrumentSizeLabel(referenceSymbol, sizeMultiplier) : `${fmtNumber(sizeMultiplier)} units`;
}

function tradeCadence(trades: BacktestTrade[]) {
  const times = trades.map((trade) => Date.parse(trade.entryTime)).filter((time) => Number.isFinite(time));
  if (!times.length) {
    return {
      tradesPerDay: 0,
      tradesPerWeek: 0
    };
  }

  const start = Math.min(...times);
  const end = Math.max(...times);
  const days = Math.max((end - start) / 86_400_000, 1);
  return {
    tradesPerDay: trades.length / days,
    tradesPerWeek: trades.length / (days / 7)
  };
}

function numericParam(value: string | undefined, fallback: number, min = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

function challengeRulesFromParams(
  params: Awaited<HomeProps["searchParams"]> | undefined,
  fallback: ChallengeRules = DEFAULT_CHALLENGE_RULES
): ChallengeRules {
  return {
    startingBalance: numericParam(params?.accountSize, fallback.startingBalance, 1),
    profitTarget: numericParam(params?.profitTarget, fallback.profitTarget, 1),
    maximumLossLimit: numericParam(params?.maxLoss, fallback.maximumLossLimit),
    dailyLossLimit: numericParam(params?.dailyLoss, fallback.dailyLossLimit),
    dailyProfitLock: numericParam(params?.dailyLock, fallback.dailyProfitLock),
    dailyLossStop: numericParam(params?.dailyStop, fallback.dailyLossStop)
  };
}

type SyncTileState = "idle" | "running" | "success" | "failed";

function syncTileState(
  run: { startedAt?: string; state?: string } | undefined,
  lastSuccessfulAt?: string,
  runningTimeoutMs = 10 * 60_000
): SyncTileState {
  if (run?.state === "running") {
    const startedAt = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
    return Number.isFinite(startedAt) && Date.now() - startedAt > runningTimeoutMs ? "failed" : "running";
  }
  if (run?.state === "failed") return "failed";
  if (run?.state === "success" || lastSuccessfulAt) return "success";
  return "idle";
}

function syncTileLabel(state: SyncTileState): string {
  if (state === "running") return "Running";
  if (state === "success") return "Success";
  if (state === "failed") return "Failed";
  return "Waiting";
}

type SyncTileRun = {
  error?: string;
  finishedAt?: string;
  startedAt?: string;
  state?: string;
};

function syncTileStatusTimestamp(
  state: SyncTileState,
  run: SyncTileRun | undefined,
  lastSuccessfulAt?: string
): { label: string; value: string } | undefined {
  if (state === "running" && run?.startedAt) return { label: "started", value: run.startedAt };
  if (state === "success") {
    const value = run?.finishedAt ?? lastSuccessfulAt;
    return value ? { label: "at", value } : undefined;
  }
  if (state === "failed") {
    const value = run?.finishedAt ?? run?.startedAt;
    return value ? { label: "at", value } : undefined;
  }
  return undefined;
}

function syncTileErrorText(state: SyncTileState, run: SyncTileRun | undefined): string | undefined {
  if (state !== "failed" || !run?.error) return undefined;
  return run.error.length > 220 ? `${run.error.slice(0, 217)}...` : run.error;
}

function SyncTileStatus({
  lastSuccessfulAt,
  run,
  state
}: {
  lastSuccessfulAt?: string;
  run?: SyncTileRun;
  state: SyncTileState;
}) {
  const timestamp = syncTileStatusTimestamp(state, run, lastSuccessfulAt);
  return (
    <>
      <span className="sync-status-value" title={run?.error}>
        <span>{syncTileLabel(state)}</span>
        {timestamp ? (
          <span className="sync-status-date">
            {timestamp.label} <LocalDateTime value={timestamp.value} />
          </span>
        ) : null}
      </span>
      {syncTileErrorText(state, run) ? (
        <span className="sync-status-error" title={run?.error}>
          {syncTileErrorText(state, run)}
        </span>
      ) : null}
    </>
  );
}

function DataValidityBox({
  className = "",
  dataValidity
}: {
  className?: string;
  dataValidity: DataValidityResult;
}) {
  const syncStateClass = dataValidity.tone === "good" ? "success" : dataValidity.tone === "bad" ? "failed" : "running";
  return (
    <div
      className={`dataset-sync-tile dataValidityBox sync-state-${syncStateClass} ${className} ${dataValidityClass(dataValidity.tone)}`.trim()}
      title={dataValidity.detailTitle}
      aria-label={`Review Validity: ${dataValidity.label}. ${dataValidity.summary}`}
    >
      <span className="sync-tile-name">Review validity</span>
      <dl className="sync-tile-times">
        <dt>Status</dt>
        <dd>
          <strong>{dataValidity.label}</strong>
        </dd>
        <dt>Checks</dt>
        <dd>{dataValidity.summary}</dd>
      </dl>
    </div>
  );
}

function accountSizeMultiplier(rules: ChallengeRules): number {
  return Math.max(0.01, rules.startingBalance / DEFAULT_CHALLENGE_RULES.startingBalance);
}

function resultClass(value: number): string {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "neutral";
}

function resultRowClass(value: number): string {
  if (value > 0) return "up-row";
  if (value < 0) return "down-row";
  return "neutral-row";
}

function tradeSizeMultiplier(trade: BacktestTrade, fallback = 1): number {
  return trade.sizeMultiplierHint ?? fallback;
}

type ClosedLiveLifecycleStatus = Exclude<NonNullable<TradeAlert["lifecycleStatus"]>, "open">;
type LiveTradeEvent = {
  className: string;
  kind: "edit_limit" | "edit_sl" | "edit_tp" | "entry" | "limit" | "exit";
  label: string;
  managementEvent?: TradeManagementEvent;
  title: string;
};

function finiteNumberOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function liveRowClass(trade: TradeAlert): string {
  if (Number.isFinite(trade.lifecyclePnlDollars)) {
    return resultRowClass(trade.lifecyclePnlDollars!);
  }
  if (trade.lifecycleStatus === "take_profit") return "up-row";
  if (trade.lifecycleStatus === "stop_loss") return "down-row";
  return "neutral-row";
}

function isClosedLifecycleStatus(status: TradeAlert["lifecycleStatus"]): status is ClosedLiveLifecycleStatus {
  return status === "take_profit" || status === "stop_loss" || status === "max_bars";
}

function liveTradeClosed(trade: TradeAlert): trade is TradeAlert & { lifecycleStatus: ClosedLiveLifecycleStatus; lifecycleTime: string } {
  return isClosedLifecycleStatus(trade.lifecycleStatus) && Boolean(trade.lifecycleTime);
}

function liveTradeHasLimitOrder(trade: TradeAlert): boolean {
  return trade.entryType === "limit";
}

function liveTradeExitReasonLabel(trade: TradeAlert): string {
  return isClosedLifecycleStatus(trade.lifecycleStatus) ? fmtExitReason(trade.lifecycleStatus) : "--";
}

function liveTradeExitStatusClass(trade: TradeAlert): string {
  if (trade.lifecycleStatus === "take_profit") return "sent";
  if (trade.lifecycleStatus === "stop_loss") return "failed";
  if (trade.lifecycleStatus === "max_bars") return "skipped";
  return "skipped";
}

function isManagementLiveTradeEvent(event: LiveTradeEvent): event is LiveTradeEvent & { managementEvent: TradeManagementEvent } {
  return Boolean(event.managementEvent);
}

function managementEventLabel(event: TradeManagementEvent): string {
  if (event.type === "edit_tp") return "Edit TP";
  if (event.type === "edit_sl") return "Edit SL";
  return "Edit Limit";
}

function managementEventClass(event: TradeManagementEvent): string {
  if (event.type === "edit_tp") return "management tp";
  if (event.type === "edit_sl") return "management sl";
  return "management limit";
}

function managementEventTitle(event: TradeManagementEvent): string {
  const previous = event.previousPrice !== undefined ? ` from ${fmtPrice(event.previousPrice)}` : "";
  const reason = event.reason ? ` - ${event.reason}` : "";
  return `${managementEventLabel(event)}${previous} to ${fmtPrice(event.price)}${reason}`;
}

function liveTradeEvents(trade: TradeAlert): LiveTradeEvent[] {
  const hasLimitOrder = liveTradeHasLimitOrder(trade);
  const events: LiveTradeEvent[] = [];

  if (trade.entryType === "limit") {
    events.push({
      className: "limit",
      kind: "limit",
      label: "Limit Order",
      title: "Strategy generated a limit-order signal."
    });
  } else {
    events.push({
      className: "entry",
      kind: "entry",
      label: "Trade Entry",
      title: "Strategy generated a trade-entry signal."
    });
    if (hasLimitOrder) {
      events.push({
        className: "limit",
        kind: "limit",
        label: "Limit Order",
        title: "Strategy includes a limit-order component for this signal."
      });
    }
  }

  for (const managementEvent of [...(trade.managementEvents ?? [])]
    .filter((event) => Number.isFinite(event.price) && (event.type !== "edit_limit" || hasLimitOrder))
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))) {
    events.push({
      className: managementEventClass(managementEvent),
      kind: managementEvent.type,
      label: managementEventLabel(managementEvent),
      managementEvent,
      title: managementEventTitle(managementEvent)
    });
  }

  if (liveTradeClosed(trade)) {
    const exitClass = trade.lifecycleStatus === "take_profit" ? "exit win" : trade.lifecycleStatus === "stop_loss" ? "exit loss" : "exit neutral";
    events.push({
      className: exitClass,
      kind: "exit",
      label: "Trade Exit",
      title: `${liveTradeExitReasonLabel(trade)} at ${fmtPrice(finiteNumberOr(trade.lifecyclePrice, trade.entryPrice))}`
    });
  }

  return events;
}

function liveTradeEventTime(trade: TradeAlert, event: LiveTradeEvent): string {
  if (isManagementLiveTradeEvent(event)) return event.managementEvent.time;
  return event.kind === "exit" && liveTradeClosed(trade) ? trade.lifecycleTime : trade.signalTime;
}

function liveTradeEventTelegramStatus(trade: TradeAlert, event: LiveTradeEvent): TradeAlert["telegramStatus"] {
  if (isManagementLiveTradeEvent(event)) return event.managementEvent.telegramStatus ?? "skipped";
  if (event.kind === "exit") return trade.telegramLifecycleStatus ?? trade.telegramStatus;
  if (event.kind === "limit") return trade.limitOrderTelegramStatus ?? trade.telegramStatus;
  return trade.telegramStatus;
}

function liveTradeEventEntryPrice(trade: TradeAlert, event: LiveTradeEvent): number {
  if (isManagementLiveTradeEvent(event) && event.managementEvent.entryPrice !== undefined) return event.managementEvent.entryPrice;
  if (event.kind === "edit_limit" && isManagementLiveTradeEvent(event)) return event.managementEvent.price;
  if (event.kind !== "limit") return trade.entryPrice;
  return trade.entryPrice;
}

function liveTradeEventSizeMultiplier(trade: TradeAlert, event: LiveTradeEvent): number {
  if (event.kind === "limit" || event.kind === "edit_limit") {
    return trade.sizeMultiplier ?? 1;
  }
  if (event.kind === "entry") return trade.sizeMultiplier ?? 1;
  return trade.sizeMultiplier ?? 1;
}

function liveTradeEventSizeLabel(trade: TradeAlert, event: LiveTradeEvent): string {
  return instrumentSizeLabel(trade.symbol, liveTradeEventSizeMultiplier(trade, event));
}

function liveTradeEventPriceUnit(trade: TradeAlert, event: LiveTradeEvent): number {
  return inferredAlertPriceUnit(trade, 0);
}

function liveTradeEventTpUnits(trade: TradeAlert, event: LiveTradeEvent): number {
  if (event.kind === "entry" || event.kind === "exit") return trade.tpUnits;
  const priceUnit = liveTradeEventPriceUnit(trade, event);
  return priceUnit > 0 ? Math.abs(liveTradeEventTakeProfitPrice(trade, event) - liveTradeEventEntryPrice(trade, event)) / priceUnit : trade.tpUnits;
}

function liveTradeEventSlUnits(trade: TradeAlert, event: LiveTradeEvent): number {
  if (event.kind === "entry" || event.kind === "exit") return trade.slUnits;
  const priceUnit = liveTradeEventPriceUnit(trade, event);
  return priceUnit > 0 ? Math.abs(liveTradeEventEntryPrice(trade, event) - liveTradeEventStopLossPrice(trade, event)) / priceUnit : trade.slUnits;
}

function liveTradeEventTakeProfitPrice(trade: TradeAlert, event: LiveTradeEvent): number {
  if (isManagementLiveTradeEvent(event) && event.managementEvent.takeProfitPrice !== undefined) return event.managementEvent.takeProfitPrice;
  if (event.kind === "edit_tp" && isManagementLiveTradeEvent(event)) return event.managementEvent.price;
  return trade.takeProfitPrice;
}

function liveTradeEventStopLossPrice(trade: TradeAlert, event: LiveTradeEvent): number {
  if (isManagementLiveTradeEvent(event) && event.managementEvent.stopLossPrice !== undefined) return event.managementEvent.stopLossPrice;
  if (event.kind === "edit_sl" && isManagementLiveTradeEvent(event)) return event.managementEvent.price;
  return trade.stopLossPrice;
}

function liveTradeEventTargetDollars(trade: TradeAlert, event: LiveTradeEvent): number {
  return Math.abs(liveTradeEventTpUnits(trade, event) * dollarPerUnit(trade.symbol, liveTradeEventEntryPrice(trade, event)) * liveTradeEventSizeMultiplier(trade, event));
}

function liveTradeEventRiskDollars(trade: TradeAlert, event: LiveTradeEvent): number {
  return Math.abs(liveTradeEventSlUnits(trade, event) * dollarPerUnit(trade.symbol, liveTradeEventEntryPrice(trade, event)) * liveTradeEventSizeMultiplier(trade, event));
}

function autoTradeStatusClass(trade: TradeAlert): string {
  if (trade.autoTradeStatus === "placed") return "sent";
  if (trade.autoTradeStatus === "failed") return "failed";
  return "skipped";
}

function autoTradeStatusLabel(trade: TradeAlert): string {
  if (!trade.autoTradeStatus) return "off";
  if (trade.autoTradeStatus === "placed") return "placed";
  if (trade.autoTradeStatus === "dry_run") return "dry run";
  return trade.autoTradeStatus;
}

function liveTradeEventAutoTradeStatus(trade: TradeAlert, event: LiveTradeEvent): TradeAlert["autoTradeStatus"] | undefined {
  if (isManagementLiveTradeEvent(event)) return event.managementEvent.autoTradeStatus;
  return event.kind === "limit" ? trade.limitOrderAutoTradeStatus ?? trade.autoTradeStatus : trade.autoTradeStatus;
}

function liveTradeEventAutoTradeError(trade: TradeAlert, event: LiveTradeEvent): string | undefined {
  if (isManagementLiveTradeEvent(event)) return event.managementEvent.autoTradeError;
  return event.kind === "limit" ? trade.limitOrderAutoTradeError ?? trade.autoTradeError : trade.autoTradeError;
}

function liveTradeEventAutoTradeStatusClass(trade: TradeAlert, event: LiveTradeEvent): string {
  const status = liveTradeEventAutoTradeStatus(trade, event);
  if (status === "placed") return "sent";
  if (status === "failed") return "failed";
  return "skipped";
}

function liveTradeEventAutoTradeStatusLabel(trade: TradeAlert, event: LiveTradeEvent): string {
  const status = liveTradeEventAutoTradeStatus(trade, event);
  if (!status) return "off";
  if (status === "placed") return "placed";
  if (status === "dry_run") return "dry run";
  return status;
}

function tradeDollarPnl(trade: BacktestTrade, sizeMultiplier = 1): number {
  return trade.netUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * tradeSizeMultiplier(trade, sizeMultiplier);
}

function tradeCostUnits(trade: BacktestTrade): number {
  return 0;
}

function tradeTargetDollars(trade: BacktestTrade, sizeMultiplier = 1): number {
  return Math.abs(trade.tpUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * tradeSizeMultiplier(trade, sizeMultiplier));
}

function tradeRiskDollars(trade: BacktestTrade, sizeMultiplier = 1): number {
  const netRiskUnits = Math.abs(trade.slUnits) + tradeCostUnits(trade);
  return Math.abs(netRiskUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * tradeSizeMultiplier(trade, sizeMultiplier));
}

function analyzeBacktestDataValidity({
  backtestBehindMarketData,
  now = Date.now(),
  optionByKey,
  trades
}: {
  backtestBehindMarketData: boolean;
  now?: number;
  optionByKey: Map<string, StrategyOption>;
  trades: BacktestTrade[];
}): DataValidityResult {
  const issues: DataValidityIssue[] = [];

  if (!trades.length) {
    return {
      detailTitle: "No stored backtest trades are available for this market.",
      issues: [{ count: 1, label: "No trades", tone: "bad" }],
      label: "No data",
      summary: "Nothing to validate",
      tone: "bad"
    };
  }

  const duplicateFingerprints = new Map<string, number>();
  let futureDated = 0;
  let impossibleDurations = 0;
  let invalidMath = 0;
  let invalidPrices = 0;
  let invalidTimes = 0;
  let missingStrategies = 0;

  for (const trade of trades) {
    const signalTime = Date.parse(trade.signalTime);
    const entryTime = Date.parse(trade.entryTime);
    const exitTime = Date.parse(trade.exitTime);
    const hasInvalidTime = !Number.isFinite(signalTime) || !Number.isFinite(entryTime) || !Number.isFinite(exitTime);

    if (hasInvalidTime) {
      invalidTimes += 1;
    } else {
      if (exitTime < entryTime || trade.exitIndex < trade.entryIndex || trade.barsHeld < 0) impossibleDurations += 1;
      if (signalTime > now + 86_400_000 || entryTime > now + 86_400_000 || exitTime > now + 86_400_000) futureDated += 1;
    }

    if (!Number.isFinite(trade.entryPrice) || !Number.isFinite(trade.exitPrice) || trade.entryPrice <= 0 || trade.exitPrice <= 0) {
      invalidPrices += 1;
    }

    const dollarPnl = tradeDollarPnl(trade, optionByKey.get(trade.datasetId)?.sizeMultiplier ?? 1);
    if (
      !Number.isFinite(trade.barsHeld) ||
      !Number.isFinite(trade.netUnits) ||
      !Number.isFinite(trade.rMultiple) ||
      !Number.isFinite(trade.slUnits) ||
      !Number.isFinite(trade.tpUnits) ||
      !Number.isFinite(dollarPnl)
    ) {
      invalidMath += 1;
    }

    if (!optionByKey.has(trade.datasetId)) missingStrategies += 1;

    const fingerprint = [
      trade.datasetId,
      trade.symbol,
      trade.side,
      trade.entryTime,
      trade.exitTime,
      trade.entryPrice,
      trade.exitPrice
    ].join("|");
    duplicateFingerprints.set(fingerprint, (duplicateFingerprints.get(fingerprint) ?? 0) + 1);
  }

  const duplicateTrades = [...duplicateFingerprints.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const duplicatePct = (duplicateTrades / trades.length) * 100;

  if (invalidTimes) issues.push({ count: invalidTimes, label: "Invalid timestamps", tone: "bad" });
  if (impossibleDurations) issues.push({ count: impossibleDurations, label: "Impossible durations", tone: "bad" });
  if (invalidPrices) issues.push({ count: invalidPrices, label: "Invalid prices", tone: "bad" });
  if (invalidMath) issues.push({ count: invalidMath, label: "Invalid math", tone: "bad" });
  if (futureDated) issues.push({ count: futureDated, label: "Future-dated trades", tone: "bad" });
  if (missingStrategies) issues.push({ count: missingStrategies, label: "Missing strategy rows", tone: "warning" });
  if (duplicateTrades) {
    issues.push({
      count: duplicateTrades,
      label: `Potential duplicates (${fmtNumber(duplicatePct)}%)`,
      tone: duplicatePct >= 5 ? "bad" : "warning"
    });
  }
  if (backtestBehindMarketData) issues.push({ count: 1, label: "Backtest behind market data", tone: "warning" });

  const tone = issues.reduce<DataValidityTone>(
    (current, issue) => (dataValidityIssueRank(issue) > dataValidityRank(current) ? issue.tone : current),
    "good"
  );
  const sortedIssues = [...issues].sort((left, right) => dataValidityIssueRank(right) - dataValidityIssueRank(left) || right.count - left.count);
  const issueSummary = sortedIssues
    .slice(0, 2)
    .map((issue) => `${fmtNumber(issue.count)} ${issue.label.toLowerCase()}`)
    .join(" / ");

  return {
    detailTitle: sortedIssues.length
      ? sortedIssues.map((issue) => `${issue.label}: ${fmtNumber(issue.count)}`).join("\n")
      : `Checked ${fmtNumber(trades.length)} trades with no anomalies found.`,
    issues: sortedIssues,
    label: tone === "bad" ? "Sus" : tone === "warning" ? "Review" : "Clean",
    summary: issueSummary || `${fmtNumber(trades.length)} trades checked`,
    tone
  };
}

function recentStrategyTrades(trades: BacktestTrade[]): BacktestTrade[] {
  return [...trades]
    .sort((left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime))
    .slice(0, 2);
}

function sameRecentDisplay(values: string[]): boolean {
  return values.length < 2 || values[0] === values[1];
}

function latestStrategyTradeTime(trades: BacktestTrade[]): number {
  return Math.max(0, ...trades.map((trade) => Date.parse(trade.entryTime)).filter(Number.isFinite));
}

async function safeRuntimeValue<T>(loader: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

function nextCronRunIso(matches: (date: Date) => boolean, now = new Date()): string {
  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  if (candidate.getTime() <= now.getTime()) candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  for (let offset = 0; offset < 60 * 24 * 8; offset += 1) {
    if (matches(candidate)) return candidate.toISOString();
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  return candidate.toISOString();
}

function safeRiskRewardRatio(targetDollars: number, riskDollars: number): number | undefined {
  return riskDollars > 0 ? targetDollars / riskDollars : undefined;
}

function strategyTableSnapshot(
  trades: BacktestTrade[],
  fallbackSymbol: string,
  fallbackSizeMultiplier: number,
  fallbackTargetDollars: number,
  fallbackRiskDollars: number
): {
  targetDollars: number;
  riskDollars: number;
  riskRewardRatio?: number;
  sizeMultiplier: number;
  sizeLabel: string;
  tpMode?: BacktestPriceMode;
  slMode?: BacktestPriceMode;
  sizeMode?: BacktestSizeMode;
  rrrMode?: BacktestPriceMode;
} {
  const recentTrades = recentStrategyTrades(trades);
  if (!recentTrades.length) {
    return {
      targetDollars: fallbackTargetDollars,
      riskDollars: fallbackRiskDollars,
      riskRewardRatio: safeRiskRewardRatio(fallbackTargetDollars, fallbackRiskDollars),
      sizeMultiplier: fallbackSizeMultiplier,
      sizeLabel: instrumentSizeLabel(fallbackSymbol, fallbackSizeMultiplier)
    };
  }

  const latestTrade = recentTrades[0]!;
  const latestSizeMultiplier = tradeSizeMultiplier(latestTrade, fallbackSizeMultiplier);
  const latestTargetDollars = tradeTargetDollars(latestTrade, fallbackSizeMultiplier);
  const latestRiskDollars = tradeRiskDollars(latestTrade, fallbackSizeMultiplier);
  const targetLabels = recentTrades.map((trade) => fmtMoney(tradeTargetDollars(trade, fallbackSizeMultiplier)));
  const riskLabels = recentTrades.map((trade) => fmtMoney(tradeRiskDollars(trade, fallbackSizeMultiplier)));
  const sizeLabels = recentTrades.map((trade) =>
    instrumentSizeLabel(trade.symbol || fallbackSymbol, tradeSizeMultiplier(trade, fallbackSizeMultiplier))
  );
  const ratioLabels = recentTrades.map((trade) => {
    const ratio = safeRiskRewardRatio(
      tradeTargetDollars(trade, fallbackSizeMultiplier),
      tradeRiskDollars(trade, fallbackSizeMultiplier)
    );
    return ratio !== undefined ? ratio.toFixed(6) : "";
  });

  return {
    targetDollars: latestTargetDollars,
    riskDollars: latestRiskDollars,
    riskRewardRatio: safeRiskRewardRatio(latestTargetDollars, latestRiskDollars),
    sizeMultiplier: latestSizeMultiplier,
    sizeLabel: instrumentSizeLabel(latestTrade.symbol || fallbackSymbol, latestSizeMultiplier),
    tpMode: sameRecentDisplay(targetLabels) ? "fixed" : "custom",
    slMode: sameRecentDisplay(riskLabels) ? "fixed" : "custom",
    sizeMode: sameRecentDisplay(sizeLabels) ? "auto" : "custom",
    rrrMode: sameRecentDisplay(ratioLabels) ? "fixed" : "custom"
  };
}

function tradeTargetPrice(trade: BacktestTrade, priceUnit: number): number {
  const direction = trade.side === "long" ? 1 : -1;
  return trade.entryPrice + direction * trade.tpUnits * priceUnit;
}

function tradeStopPrice(trade: BacktestTrade, priceUnit: number): number {
  const direction = trade.side === "long" ? 1 : -1;
  return trade.entryPrice - direction * trade.slUnits * priceUnit;
}

function tradeDollarsPerPricePoint(trade: BacktestTrade, priceUnit: number, sizeMultiplier = 1): number {
  if (!(priceUnit > 0)) return 0;
  return (dollarPerUnit(trade.symbol, trade.entryPrice) * tradeSizeMultiplier(trade, sizeMultiplier)) / priceUnit;
}

function alertTargetDollars(trade: TradeAlert): number {
  return Math.abs(trade.tpUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * (trade.sizeMultiplier ?? 1));
}

function alertRiskDollars(trade: TradeAlert): number {
  return Math.abs(trade.slUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * (trade.sizeMultiplier ?? 1));
}

function alertTargetDollarsWithSize(trade: TradeAlert, sizeMultiplier: number): number {
  return Math.abs(trade.tpUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * sizeMultiplier);
}

function alertRiskDollarsWithSize(trade: TradeAlert, sizeMultiplier: number): number {
  return Math.abs(trade.slUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * sizeMultiplier);
}

function inferredAlertPriceUnit(trade: TradeAlert, fallback = 1): number {
  if (fallback > 0 && Number.isFinite(fallback)) return fallback;
  const targetDelta = Math.abs(trade.takeProfitPrice - trade.entryPrice);
  if (targetDelta > 0 && trade.tpUnits > 0) return targetDelta / trade.tpUnits;
  const stopDelta = Math.abs(trade.entryPrice - trade.stopLossPrice);
  if (stopDelta > 0 && trade.slUnits > 0) return stopDelta / trade.slUnits;
  return 1;
}

function liveTradeHistoryFingerprint(strategyKey: string, symbol: string, side: string, signalTime: string): string {
  const parsedSignalTime = Date.parse(signalTime);
  const normalizedSignalTime = Number.isFinite(parsedSignalTime) ? new Date(parsedSignalTime).toISOString() : signalTime;
  return `${strategyKey}|${symbol}|${side}|${normalizedSignalTime}`;
}

function approximateBarsHeld(startValue: string, endValue: string, timeframeMinutes = 15): number {
  const start = Date.parse(startValue);
  const end = Date.parse(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.max(1, Math.round((end - start) / (timeframeMinutes * 60_000)));
}

function challengeSessionCount(trades: { entryTime: string; pnlDollars: number }[]): number {
  const sessions = new Set<string>();
  for (const trade of trades) {
    const parsed = Date.parse(trade.entryTime);
    if (Number.isFinite(parsed) && Number.isFinite(trade.pnlDollars)) {
      sessions.add(topstepSessionKey(new Date(parsed)));
    }
  }
  return sessions.size;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const [liveTrades, strategyCatalog, backtestStats, backtestTrades, liveRules, liveConfig, datasetStatus, backtestFreshness] = await Promise.all([
    safeRuntimeValue(getTrades, []),
    getStrategyCatalog(),
    getBacktestStats(),
    getBacktestTrades(),
    allRules(),
    safeRuntimeValue(getLiveConfig, EMPTY_LIVE_CONFIG),
    safeRuntimeValue(async () => (await getDatasetStatus()) ?? defaultDatasetStatus(), defaultDatasetStatus()),
    getBacktestCatalogFreshness()
  ]);
  const activeMarket = parseMarketTab(params?.market, liveConfig.dashboardSettings.activeMarket);
  const persistedMarketChallengeRules = liveConfig.dashboardSettings.challengeRulesByMarket?.[activeMarket];
  const persistedChallengeRulesSource = persistedMarketChallengeRules ?? liveConfig.dashboardSettings.challengeRules;
  const persistedChallengeRules = persistedChallengeRulesSource
    ? { ...DEFAULT_CHALLENGE_RULES, ...persistedChallengeRulesSource }
    : DEFAULT_CHALLENGE_RULES;
  const challengeRules = challengeRulesFromParams(params, persistedChallengeRules);
  const accountMultiplier = accountSizeMultiplier(challengeRules);
  const syncStatus = datasetStatus?.sync ?? {};
  const legacyDatasetSyncAt = datasetStatus?.sync ? undefined : datasetStatus?.lastSyncAt;
  const marketDataSyncState = syncTileState(syncStatus.marketDataSync, syncStatus.lastMarketDataSyncAt ?? legacyDatasetSyncAt);
  const signalTradeCheckState = syncTileState(syncStatus.signalTradeCheck, syncStatus.lastSignalTradeCheckAt);
  const latestBacktestTradeAt = backtestFreshness.latestTradeAt;
  const latestTradeAt = latestIsoTime([latestLiveTradeAt(liveTrades), latestBacktestTradeAt]);
  const backtestManifestAt = syncStatus.lastDataValidityRefreshAt ?? backtestFreshness.generatedAt;
  const dataEndsAt = backtestFreshness.computedThroughAt ?? latestDatasetCoverageAt(datasetStatus);
  const backtestBehindMarketData = false;
  const now = new Date();
  const nextMarketDataSyncAt = nextCronRunIso((date) => date.getUTCMinutes() % 5 === 0, now);
  const nextSignalTradeCheckAt = nextCronRunIso((date) => [2, 17, 32, 47].includes(date.getUTCMinutes()), now);
  const liveRuleByKey = new Map(liveRules.map((rule) => [rule.key, rule]));
  const statByKey = new Map(backtestStats.map((stat) => [stat.key, stat]));

  const statsByStrategy = new Map<string, BacktestStat[]>();
  for (const stat of backtestStats) {
    const bucket = statsByStrategy.get(stat.datasetId) ?? [];
    bucket.push(stat);
    statsByStrategy.set(stat.datasetId, bucket);
  }

  const tradesByStrategy = new Map<string, BacktestTrade[]>();
  for (const trade of backtestTrades) {
    const bucket = tradesByStrategy.get(trade.datasetId) ?? [];
    bucket.push(trade);
    tradesByStrategy.set(trade.datasetId, bucket);
  }

  const allStrategyOptions = strategyCatalog
    .map((entry) => {
      const stats = statsByStrategy.get(entry.key) ?? [];
      const trades = tradesByStrategy.get(entry.key) ?? [];
      const aggregate = aggregateBacktest(trades);
      const cadence = tradeCadence(trades);
      const symbols = uniqueValues(
        [...stats.map((stat) => stat.symbol), ...trades.map((trade) => trade.symbol)].filter((value): value is string => Boolean(value))
      ).sort();
      const displaySymbols = symbols.length ? symbols : [entry.symbol];
      const markets = uniqueValues(
        [...stats.map((stat) => stat.market), ...trades.map((trade) => trade.market)]
          .map((value) => normalizedDashboardMarket(value) ?? value)
          .filter((value): value is string => Boolean(value))
      ).sort();
      const phases = uniqueValues(stats.map((stat) => stat.phase).filter(Boolean)).sort();
      const logicalKeys = uniqueValues(stats.map((stat) => stat.logicalKey).filter(Boolean)).sort();
      const baseSizeMultiplier = (stats[0]?.sizeMultiplier ?? 1) * accountMultiplier;
      const fallbackTargetDollars =
        averageNumbers(trades.map((trade) => Math.abs(trade.tpUnits * dollarPerUnit(trade.symbol, trade.entryPrice)))) * baseSizeMultiplier;
      const fallbackRiskDollars =
        averageNumbers(
          trades.map((trade) => Math.abs((Math.abs(trade.slUnits) + tradeCostUnits(trade)) * dollarPerUnit(trade.symbol, trade.entryPrice)))
        ) * baseSizeMultiplier;
      const liveSupported = entry.liveSupported || logicalKeys.some((key) => liveRuleByKey.has(key));
      const displaySymbol = displaySymbols[0] ?? entry.symbol;
      const snapshot = strategyTableSnapshot(trades, displaySymbol, baseSizeMultiplier, fallbackTargetDollars, fallbackRiskDollars);

      return {
        key: entry.key,
        assetKey: entry.assetKey,
        label: entry.label,
        aliases: uniqueValues([
          entry.label,
          entry.symbol,
          ...entry.timeframes,
          normalizedDashboardMarket(entry.market) ?? entry.market,
          ...displaySymbols,
          ...phases,
          ...stats.map((stat) => `${stat.symbol} ${stat.phase}`),
          ...stats.map((stat) => stat.variantId ?? "")
        ]).filter(Boolean),
        logicalKeys,
        logicalKey: entry.key,
        datasetId: entry.key,
        timeframeLabel: entry.timeframes.join(", "),
        symbol: assetLabel(displaySymbols),
        phase: phases[0] ?? entry.key,
        market: markets.length === 1 ? markets[0] : markets.length > 1 ? "multi" : normalizedDashboardMarket(entry.market) ?? entry.market,
        winRatePct: aggregate.winRatePct,
        profitFactor: aggregate.profitFactor,
        trades: aggregate.trades,
        tradesPerWeek: cadence.tradesPerWeek,
        tpUnits: snapshot.targetDollars,
        slUnits: snapshot.riskDollars,
        unitLabel: "avg $",
        dollarPerUnit: 1,
        sizeMultiplier: snapshot.sizeMultiplier,
        targetDollars: snapshot.targetDollars,
        riskDollars: snapshot.riskDollars,
        riskRewardRatio: snapshot.riskRewardRatio,
        sizeLabel: snapshot.sizeLabel,
        tpMode: snapshot.tpMode,
        slMode: snapshot.slMode,
        sizeMode: snapshot.sizeMode,
        rrrMode: snapshot.rrrMode,
        liveSupported,
        stat: stats[0]
      } satisfies StrategyOption;
    })
    .sort((left, right) => {
      if (left.liveSupported !== right.liveSupported) return left.liveSupported ? -1 : 1;
      if (left.trades === 0 || right.trades === 0) return left.trades === right.trades ? 0 : left.trades ? -1 : 1;
      return right.profitFactor - left.profitFactor;
    });
  const strategyOptions = allStrategyOptions.filter((option) => strategyVisibleInMarket(option.market, activeMarket));
  const optionByKey = new Map(strategyOptions.map((option) => [option.key, option]));
  const allKeys = strategyOptions.map((option) => option.key);
  const persistedLiveEnabledKeys = liveConfig.enabledDatasetIds.filter((key) => allKeys.includes(key));
  const persistedSelectedKeys = liveConfig.dashboardSelectedDatasetIds.filter((key) => allKeys.includes(key));
  const recentDefaultKeys = [...strategyOptions]
    .sort((left, right) => latestStrategyTradeTime(tradesByStrategy.get(right.key) ?? []) - latestStrategyTradeTime(tradesByStrategy.get(left.key) ?? []))
    .slice(0, DEFAULT_SELECTED_STRATEGY_COUNT)
    .map((option) => option.key);
  const defaultSelectedKeys = persistedSelectedKeys.length ? persistedSelectedKeys : recentDefaultKeys;
  const selectedKeys = parseSelection(params?.strategies, allKeys, defaultSelectedKeys);
  const selectedKeySet = new Set(selectedKeys);
  const activeMarketKeySet = new Set(allKeys);
  const optionByLiveKey = new Map<string, StrategyOption>();
  for (const option of strategyOptions) {
    for (const key of [option.key, option.datasetId, option.logicalKey, ...option.logicalKeys]) {
      if (key) optionByLiveKey.set(key, option);
    }
  }
  const optionForLiveTrade = (trade: TradeAlert): StrategyOption | undefined => {
    for (const key of [trade.datasetId, trade.strategyKey, trade.logicalStrategyKey, trade.strategyId]) {
      if (!key) continue;
      const option = optionByLiveKey.get(key);
      if (option) return option;
    }
    return strategyOptions.find((option) => option.aliases.includes(trade.strategy));
  };
  const selectedLiveKeys = new Set(
    strategyOptions.filter((option) => selectedKeySet.has(option.key) && option.liveSupported).flatMap((option) => option.logicalKeys)
  );
  const selectedLiveTradeKeys = new Set([...selectedKeySet, ...selectedLiveKeys]);
  const selectedStrategyNames = new Set(
    strategyOptions
      .filter((option) => selectedKeySet.has(option.key))
      .flatMap((option) => option.aliases)
  );
  const selectedLiveTrades = liveTrades.filter(
    (trade) =>
      (trade.datasetId && selectedLiveTradeKeys.has(trade.datasetId)) ||
      (trade.strategyKey && selectedLiveTradeKeys.has(trade.strategyKey)) ||
      (trade.logicalStrategyKey && selectedLiveTradeKeys.has(trade.logicalStrategyKey)) ||
      selectedStrategyNames.has(trade.strategy)
  );
  const selectedLiveEventRows = selectedLiveTrades.flatMap((trade) =>
    liveTradeEvents(trade).map((event, eventIndex) => ({
      event,
      eventIndex,
      trade
    }))
  );
  const activeMarketLiveTrades = liveTrades.filter(
    (trade) => Boolean(optionForLiveTrade(trade)) || normalizedDashboardMarket(trade.market) === activeMarket
  );
  const selectedBacktestTrades = backtestTrades.filter((trade) => selectedKeySet.has(trade.datasetId));
  const activeMarketBacktestTrades = backtestTrades.filter((trade) => activeMarketKeySet.has(trade.datasetId));
  const selectedDataEndAt =
    strategyOptions
      .filter((option) => selectedKeySet.has(option.key))
      .map((option) => datasetStatus?.assetCoverage?.[option.assetKey]?.lastBarAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const selectedBasketTrades = selectedBacktestTrades.map((trade) => ({
    key: trade.datasetId,
    entryTime: trade.entryTime,
    basePnlDollars: tradeDollarPnl(trade, optionByKey.get(trade.datasetId)?.sizeMultiplier ?? 1),
    rMultiple: trade.rMultiple
  }));
  const visibleStoredBacktestHistoryTrades = activeMarketBacktestTrades.slice(0, HISTORY_VISIBLE_TRADE_LIMIT);
  const storedBacktestHistoryRows: TradeHistoryRow[] = visibleStoredBacktestHistoryTrades.map((trade, index) => {
    const sizeMultiplier = optionByKey.get(trade.datasetId)?.sizeMultiplier ?? 1;
    const tradeMultiplier = tradeSizeMultiplier(trade, sizeMultiplier);
    const dollarPnl = tradeDollarPnl(trade, sizeMultiplier);
    const unitLabel = instrumentUnitLabel(trade.symbol);
    const targetDollars = tradeTargetDollars(trade, sizeMultiplier);
    const riskDollars = tradeRiskDollars(trade, sizeMultiplier);
    const priceUnit = liveRuleByKey.get(trade.logicalKey)?.tickSize ?? statByKey.get(trade.key)?.pipOrTickSize ?? 1;
    const targetPrice = tradeTargetPrice(trade, priceUnit);
    const stopPrice = tradeStopPrice(trade, priceUnit);
    const dollarsPerPricePoint = tradeDollarsPerPricePoint(trade, priceUnit, sizeMultiplier);
    return {
      id: `${trade.key}-${trade.entryTime}-${index}`,
      strategyKey: trade.datasetId,
      rowClassName: resultRowClass(dollarPnl),
      pnlClassName: resultClass(dollarPnl),
      pnlDollars: dollarPnl,
      indexLabel: fmtNumber(index + 1),
      symbol: trade.symbol,
      modelName: optionByKey.get(trade.datasetId)?.label ?? trade.label,
      marketLabel: marketLabel(trade.market),
      market: trade.market,
      side: trade.side,
      sideLabel: sideLabel(trade.side),
      sideClassName: sideClass(trade.side),
      entryIndex: trade.entryIndex,
      exitIndex: trade.exitIndex,
      signalTime: trade.signalTime,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      sourceTimeframe: tradeSourceTimeframe(trade),
      phase: trade.phase,
      variantId: trade.variantId,
      entryType: tradeEntryType(trade),
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      targetPrice,
      stopPrice,
      signalTimeLabel: fmtTime(trade.signalTime),
      entryTimeLabel: fmtTime(trade.entryTime),
      exitTimeLabel: fmtTime(trade.exitTime),
      entryPriceLabel: fmtDollarPrice(trade.entryPrice),
      exitPriceLabel: fmtDollarPrice(trade.exitPrice),
      targetPriceLabel: fmtDollarPrice(targetPrice),
      stopPriceLabel: fmtDollarPrice(stopPrice),
      durationLabel: `${fmtNumber(trade.barsHeld)} bars`,
      durationDetailLabel: fmtDuration(trade.entryTime, trade.exitTime),
      exitReasonLabel: fmtExitReason(trade.exitReason),
      pnlLabel: fmtMoney(dollarPnl, true),
      rMultipleLabel: `${fmtNumber(trade.rMultiple)}R`,
      netUnitsLabel: `${fmtNumber(trade.netUnits)} ${unitLabel}`,
      sizeLabel: instrumentSizeLabel(trade.symbol, tradeMultiplier),
      sizeMultiplier: tradeMultiplier,
      targetRiskLabel: `${fmtMoney(targetDollars)} / ${fmtMoney(-riskDollars)}`,
      targetLabel: fmtMoney(targetDollars),
      riskLabel: fmtMoney(-riskDollars),
      targetDollars,
      riskDollars,
      dollarsPerPricePoint,
      tpUnitsLabel: `${fmtNumber(trade.tpUnits)} ${unitLabel}`,
      slUnitsLabel: `${fmtNumber(trade.slUnits)} ${unitLabel}`
    };
  });
  const storedBacktestFingerprints = new Set(
    activeMarketBacktestTrades.map((trade) => liveTradeHistoryFingerprint(trade.datasetId, trade.symbol, trade.side, trade.signalTime))
  );
  const closedLiveHistoryRows: TradeHistoryRow[] = activeMarketLiveTrades
    .filter(liveTradeClosed)
    .filter((trade) => {
      const option = optionForLiveTrade(trade);
      const strategyKey = option?.key ?? trade.datasetId ?? trade.strategyKey ?? trade.logicalStrategyKey ?? trade.strategyId ?? trade.strategy;
      if (storedBacktestFingerprints.has(liveTradeHistoryFingerprint(strategyKey, trade.symbol, trade.side, trade.signalTime))) return false;
      return (
        Number.isFinite(trade.entryPrice) &&
        trade.entryPrice > 0 &&
        Number.isFinite(finiteNumberOr(trade.lifecyclePrice, trade.entryPrice)) &&
        Date.parse(trade.signalTime) > 0 &&
        Date.parse(trade.lifecycleTime) > 0
      );
    })
    .map((trade, index) => {
      const option = optionForLiveTrade(trade);
      const strategyKey = option?.key ?? trade.datasetId ?? trade.strategyKey ?? trade.logicalStrategyKey ?? trade.strategyId ?? `live-${trade.id}`;
      const ruleKey = trade.logicalStrategyKey ?? trade.strategyKey ?? option?.logicalKeys[0] ?? strategyKey;
      const ruleTickSize = liveRuleByKey.get(ruleKey)?.tickSize;
      const priceUnit = inferredAlertPriceUnit(trade, ruleTickSize);
      const sizeMultiplier = finiteNumberOr(trade.sizeMultiplier, option?.sizeMultiplier ?? 1);
      const targetDollars = alertTargetDollarsWithSize(trade, sizeMultiplier);
      const riskDollars = alertRiskDollarsWithSize(trade, sizeMultiplier);
      const exitPrice = finiteNumberOr(trade.lifecyclePrice, trade.entryPrice);
      const pnlDollars = finiteNumberOr(
        trade.lifecyclePnlDollars,
        trade.lifecycleStatus === "take_profit" ? targetDollars : trade.lifecycleStatus === "stop_loss" ? -riskDollars : 0
      );
      const rMultiple = finiteNumberOr(trade.lifecycleRMultiple, riskDollars > 0 ? pnlDollars / riskDollars : 0);
      const sideMultiplier = trade.side === "long" ? 1 : -1;
      const netUnits = priceUnit > 0 ? ((exitPrice - trade.entryPrice) * sideMultiplier) / priceUnit : 0;
      const unitLabel = instrumentUnitLabel(trade.symbol);
      const barsHeld = approximateBarsHeld(trade.signalTime, trade.lifecycleTime);

      return {
        id: `live-${trade.id}-${index}`,
        strategyKey,
        rowClassName: resultRowClass(pnlDollars),
        pnlClassName: resultClass(pnlDollars),
        pnlDollars,
        indexLabel: fmtNumber(index + 1),
        symbol: trade.symbol,
        modelName: option?.label ?? trade.strategy,
        marketLabel: marketLabel(trade.market),
        market: trade.market,
        side: trade.side,
        sideLabel: sideLabel(trade.side),
        sideClassName: sideClass(trade.side),
        entryIndex: 0,
        exitIndex: Math.max(1, barsHeld),
        signalTime: trade.signalTime,
        entryTime: trade.signalTime,
        exitTime: trade.lifecycleTime,
        sourceTimeframe: timeframeFromVariant(option?.variantId),
        phase: option?.phase,
        variantId: option?.variantId,
        entryType: trade.entryType ?? "market",
        entryPrice: trade.entryPrice,
        exitPrice,
        targetPrice: trade.takeProfitPrice,
        stopPrice: trade.stopLossPrice,
        signalTimeLabel: fmtTime(trade.signalTime),
        entryTimeLabel: fmtTime(trade.signalTime),
        exitTimeLabel: fmtTime(trade.lifecycleTime),
        entryPriceLabel: fmtDollarPrice(trade.entryPrice),
        exitPriceLabel: fmtDollarPrice(exitPrice),
        targetPriceLabel: fmtDollarPrice(trade.takeProfitPrice),
        stopPriceLabel: fmtDollarPrice(trade.stopLossPrice),
        durationLabel: `${fmtNumber(barsHeld)} bars`,
        durationDetailLabel: fmtDuration(trade.signalTime, trade.lifecycleTime),
        exitReasonLabel: fmtExitReason(trade.lifecycleStatus),
        pnlLabel: fmtMoney(pnlDollars, true),
        rMultipleLabel: `${fmtNumber(rMultiple)}R`,
        netUnitsLabel: `${fmtNumber(netUnits)} ${unitLabel}`,
        sizeLabel: instrumentSizeLabel(trade.symbol, sizeMultiplier),
        sizeMultiplier,
        targetRiskLabel: `${fmtMoney(targetDollars)} / ${fmtMoney(-riskDollars)}`,
        targetLabel: fmtMoney(targetDollars),
        riskLabel: fmtMoney(-riskDollars),
        targetDollars,
        riskDollars,
        dollarsPerPricePoint: priceUnit > 0 ? (dollarPerUnit(trade.symbol, trade.entryPrice) * sizeMultiplier) / priceUnit : 0,
        tpUnitsLabel: `${fmtNumber(trade.tpUnits)} ${unitLabel}`,
        slUnitsLabel: `${fmtNumber(trade.slUnits)} ${unitLabel}`
      };
    });
  const historyTotalTradeCount = activeMarketBacktestTrades.length + closedLiveHistoryRows.length;
  const tradeHistoryRows = [...storedBacktestHistoryRows, ...closedLiveHistoryRows]
    .sort(
      (left, right) =>
        Date.parse(right.entryTime) - Date.parse(left.entryTime) ||
        Date.parse(right.exitTime) - Date.parse(left.exitTime) ||
        right.pnlDollars - left.pnlDollars
    )
    .map((row, index) => ({
      ...row,
      indexLabel: fmtNumber(index + 1)
    }));
  const visibleTradeHistoryRows = tradeHistoryRows.slice(0, HISTORY_VISIBLE_TRADE_LIMIT);
  const hiddenHistoryTradeCount = Math.max(0, historyTotalTradeCount - visibleTradeHistoryRows.length);
  const historyCountLabel =
    hiddenHistoryTradeCount > 0
      ? `Showing latest ${fmtNumber(visibleTradeHistoryRows.length)} of ${fmtNumber(historyTotalTradeCount)} trades`
      : `Showing ${fmtNumber(visibleTradeHistoryRows.length)} trades`;
  const historySourceLabel = closedLiveHistoryRows.length
    ? `${historyCountLabel} / ${fmtNumber(closedLiveHistoryRows.length)} closed live`
    : historyCountLabel;
  const latestHistoryTradeAt = tradeHistoryRows[0]?.entryTime ?? latestBacktestTradeAt;
  const dataValidity = analyzeBacktestDataValidity({
    backtestBehindMarketData,
    optionByKey,
    trades: activeMarketBacktestTrades
  });
  const challengeReplayTrades = selectedBacktestTrades.map((trade) => ({
      key: trade.datasetId,
      entryTime: trade.entryTime,
      pnlDollars: tradeDollarPnl(trade, optionByKey.get(trade.datasetId)?.sizeMultiplier ?? 1)
    }));
  const challengeReplaySeed = `trading-bot:${activeMarket}:${selectedKeys.join("|")}`;
  const challengeHistoricalSessions = challengeSessionCount(challengeReplayTrades);
  const telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_CHAT_ID));
  const telegramInviteLink = telegramGroupInviteLink();
  const telegramLink = telegramInviteLink ?? (telegramBotUsername ? `https://t.me/${telegramBotUsername}` : "https://t.me/BotFather");
  const alertStore = storageMode();
  const assetStore = projectAssetMode();
  const liveSelectionCount = persistedLiveEnabledKeys.length || persistedSelectedKeys.length;
  const executionMarket = activeMarket;
  const persistChallengeRules = syncChallengeRulesForMarket.bind(null, activeMarket);

  return (
    <main className="terminal">
      <AutoRefresh />
      <AutoTradeAccountGate />
      <section className="terminal-workspace marketView" id="signals" key={activeMarket}>
        <div className="marketTopShell">
          <AutoTradeAccountModeSwitch />
          <MarketSwitchTabs activeMarket={activeMarket} tabs={MARKET_TABS} persistActiveMarket={syncActiveMarket} />
        </div>
        <header className="terminal-head">
          <div className="asset-meta">
            <h1>Trading Bot</h1>
          </div>
          <div className="terminal-actions">
            <ThemeToggle initialTheme={liveConfig.dashboardSettings.theme} persistTheme={syncTheme} />
            <a className="terminal-action" href={telegramLink} target="_blank" rel="noreferrer">
              {telegramInviteLink ? "Join Telegram group" : telegramBotUsername ? "Open Telegram bot" : "Open BotFather"}
            </a>
            <TestAlertButton disabled={!telegramConfigured} sendTestAlert={sendTestTelegramAlert} />
            <AutoTradingConnectionDrawer market={executionMarket} />
          </div>
        </header>

        <section className="backtest-card">
          <div className="backtest-card-head">
            <div>
              <h2>Strategies</h2>
            </div>
            <span className="count-pill">{fmtNumber(strategyOptions.length)} strategies / {fmtNumber(selectedBacktestTrades.length)} trades</span>
          </div>

          <SelectedStrategyStats
            dataEndAt={selectedDataEndAt}
            strategies={strategyOptions}
            trades={selectedBasketTrades}
            persistedStrategyEdits={liveConfig.strategyEdits}
          />

          <StrategySelector
            market={activeMarket}
            strategies={strategyOptions}
            selectedKeys={selectedKeys}
            persistedLiveKeys={persistedLiveEnabledKeys}
            persistedCustomScaleRange={liveConfig.customScaleRanges[activeMarket] ?? {}}
            persistedStrategyEdits={liveConfig.strategyEdits}
            persistLiveSelection={syncLiveSelection}
            persistCustomScaleRange={syncCustomScaleRange}
            persistStrategyEdits={syncStrategyEdits}
          />
        </section>

        <section className="backtest-card challenge-card">
          <div className="backtest-card-head">
            <div>
              <h2>Prop Firm Challenge Replay</h2>
            </div>
            <span className="count-pill">
              {fmtNumber(challengeReplayTrades.length)} trades / {fmtNumber(challengeHistoricalSessions)} starts
            </span>
          </div>
          <ChallengeReplay
            initialRules={challengeRules}
            persistedRules={Boolean(persistedMarketChallengeRules)}
            persistRules={persistChallengeRules}
            seedPrefix={challengeReplaySeed}
            storageKey={`trading-bot:challenge-rules:v1:${activeMarket}`}
            strategies={strategyOptions}
            trades={challengeReplayTrades}
            persistedStrategyEdits={liveConfig.strategyEdits}
          />
        </section>

        <section className="backtest-card history-card" id="backtest" aria-label="Backtest trade history">
          <div className="backtest-card-head">
            <div>
              <h2>Backtest History</h2>
              <p>
                Stored backtest trades plus closed live alerts for the active market. Latest history trade:{" "}
                <LocalDateTime value={latestHistoryTradeAt} fallback="unknown" />.
              </p>
            </div>
            <div className="historyHeadActions">
              <span className={`count-pill${backtestBehindMarketData ? " warning" : ""}`}>{historySourceLabel}</span>
            </div>
          </div>

          {tradeHistoryRows.length === 0 ? (
            <div className="empty-state">
              <strong>No backtest trades match</strong>
              <span>No stored backtest trades or closed live alerts are available for this market.</span>
            </div>
          ) : (
            <EditableTradeHistory
              rows={visibleTradeHistoryRows}
              strategies={strategyOptions}
              persistedStrategyEdits={liveConfig.strategyEdits}
            />
          )}
        </section>

        <section className="backtest-card history-card" id="cron" aria-label="Cron execution history">
          <div className="backtest-card-head">
            <div>
              <h2>Cron Executions</h2>
              <p>Live alerts generated by the selected strategies.</p>
            </div>
            <span className="count-pill">
              Showing {fmtNumber(selectedLiveEventRows.length)} events / {fmtNumber(selectedLiveTrades.length)} alerts
            </span>
          </div>

          {selectedLiveTrades.length === 0 ? (
            <div className="empty-state">
              <strong>No live alerts yet</strong>
              <span>The next selected-strategy cron signal will show up here.</span>
            </div>
          ) : (
            <div className="terminal-table-wrap live">
              <table className="terminal-table live-alert-table">
                <colgroup>
                  <col className="live-col-index" />
                  <col className="live-col-ticker" />
                  <col className="live-col-model" />
                  <col className="live-col-event" />
                  <col className="live-col-direction" />
                  <col className="live-col-price" />
                  <col className="live-col-size" />
                  <col className="live-col-price" />
                  <col className="live-col-price" />
                  <col className="live-col-price" />
                  <col className="live-col-money" />
                  <col className="live-col-money" />
                  <col className="live-col-odds" />
                  <col className="live-col-status" />
                  <col className="live-col-status" />
                  <col className="live-col-time" />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Ticker</th>
                    <th>Model</th>
                    <th>Event</th>
                    <th>Direction</th>
                    <th>Entry</th>
                    <th>Size</th>
                    <th>Exit</th>
                    <th>Take Profit</th>
                    <th>Stop Loss</th>
                    <th>Target $</th>
                    <th>Risk $</th>
                    <th>Odds</th>
                    <th>Auto Trade</th>
                    <th>Telegram</th>
                    <th>Event time</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedLiveTrades.map((trade, index) => {
                    const events = liveTradeEvents(trade);
                    return (
                      <tr className={liveRowClass(trade)} key={trade.id}>
                        <td className="cronTradeCell" colSpan={16}>
                          <details className="cronTradeDetails">
                            <summary className="cronTradeSummary" aria-label={`Expand ${trade.symbol} cron events for ${fmtDate(trade.signalTime)}`}>
                              <span data-label="#">{fmtNumber(index + 1)}</span>
                              <span className="ticker-cell" data-label="Ticker">{trade.symbol}</span>
                              <span className="main-cell" data-label="Model">
                                <span>{fmtDate(trade.signalTime)}</span>
                                <small><LocalDateTime value={trade.signalTime} /></small>
                              </span>
                              <span className="event-cell" data-label="Event">
                                <span className="eventPill neutral">{fmtNumber(events.length)} events</span>
                              </span>
                              <span data-label="Direction">
                                <span className={sideClass(trade.side)}>{sideLabel(trade.side)}</span>
                              </span>
                              <span data-label="Entry">{fmtDollarPrice(trade.entryPrice)}</span>
                              <span data-label="Size">{instrumentSizeLabel(trade.symbol, trade.sizeMultiplier ?? 1)}</span>
                              <span className="exit-cell" data-label="Exit">
                                {liveTradeClosed(trade) ? (
                                  <>
                                    <span className={`status ${liveTradeExitStatusClass(trade)}`}>{liveTradeExitReasonLabel(trade)}</span>
                                    <small>{fmtDollarPrice(finiteNumberOr(trade.lifecyclePrice, trade.entryPrice))}</small>
                                  </>
                                ) : (
                                  <span className="status skipped">Pending</span>
                                )}
                              </span>
                              <span data-label="Take Profit">{fmtPrice(trade.takeProfitPrice)}</span>
                              <span data-label="Stop Loss">{fmtPrice(trade.stopLossPrice)}</span>
                              <span data-label="Target $">{fmtMoney(alertTargetDollars(trade))}</span>
                              <span data-label="Risk $">{fmtMoney(alertRiskDollars(trade))}</span>
                              <span data-label="Odds">{fmtPct(trade.estimatedWinRatePct)}</span>
                              <span data-label="Auto Trade" title={trade.autoTradeError ?? trade.autoTradeProviderName ?? trade.autoTradeContractName ?? trade.autoTradeContractId ?? undefined}>
                                <span className={`status ${autoTradeStatusClass(trade)}`}>{autoTradeStatusLabel(trade)}</span>
                              </span>
                              <span data-label="Telegram">
                                <span className={`status ${trade.telegramStatus}`}>{trade.telegramStatus}</span>
                              </span>
                              <span data-label="Event time"><LocalDateTime value={trade.signalTime} /></span>
                            </summary>
                            <div className="cronTradeEventPanel" aria-label={`${trade.symbol} cron event details`}>
                              {events.map((event, eventIndex) => (
                                <div className="cronTradeEventRow" key={`${trade.id}-${event.kind}-${eventIndex}`}>
                                  <span data-label="#">{`${fmtNumber(index + 1)}.${fmtNumber(eventIndex + 1)}`}</span>
                                  <span className="ticker-cell" data-label="Ticker">{trade.symbol}</span>
                                  <span className="main-cell" data-label="Model">
                                    <span>{fmtDate(liveTradeEventTime(trade, event))}</span>
                                    <small><LocalDateTime value={liveTradeEventTime(trade, event)} /></small>
                                  </span>
                                  <span className="event-cell" data-label="Event">
                                    <span className={`eventPill ${event.className}`} title={event.title}>
                                      {event.label}
                                    </span>
                                  </span>
                                  <span data-label="Direction">
                                    <span className={sideClass(trade.side)}>{sideLabel(trade.side)}</span>
                                  </span>
                                  <span data-label="Entry">{fmtDollarPrice(liveTradeEventEntryPrice(trade, event))}</span>
                                  <span data-label="Size">{liveTradeEventSizeLabel(trade, event)}</span>
                                  <span className="exit-cell" data-label="Exit">
                                    {event.kind === "exit" && liveTradeClosed(trade) ? (
                                      <>
                                        <span className={`status ${liveTradeExitStatusClass(trade)}`}>{liveTradeExitReasonLabel(trade)}</span>
                                        <small>{fmtDollarPrice(finiteNumberOr(trade.lifecyclePrice, trade.entryPrice))}</small>
                                      </>
                                    ) : (
                                      <span className="status skipped">Pending</span>
                                    )}
                                  </span>
                                  <span data-label="Take Profit">{fmtPrice(liveTradeEventTakeProfitPrice(trade, event))}</span>
                                  <span data-label="Stop Loss">{fmtPrice(liveTradeEventStopLossPrice(trade, event))}</span>
                                  <span data-label="Target $">{fmtMoney(liveTradeEventTargetDollars(trade, event))}</span>
                                  <span data-label="Risk $">{fmtMoney(liveTradeEventRiskDollars(trade, event))}</span>
                                  <span data-label="Odds">{fmtPct(trade.estimatedWinRatePct)}</span>
                                  <span
                                    data-label="Auto Trade"
                                    title={liveTradeEventAutoTradeError(trade, event) ?? trade.autoTradeProviderName ?? trade.autoTradeContractName ?? trade.autoTradeContractId ?? undefined}
                                  >
                                    <span className={`status ${liveTradeEventAutoTradeStatusClass(trade, event)}`}>
                                      {liveTradeEventAutoTradeStatusLabel(trade, event)}
                                    </span>
                                  </span>
                                  <span data-label="Telegram">
                                    <span className={`status ${liveTradeEventTelegramStatus(trade, event)}`}>{liveTradeEventTelegramStatus(trade, event)}</span>
                                  </span>
                                  <span data-label="Event time"><LocalDateTime value={liveTradeEventTime(trade, event)} /></span>
                                </div>
                              ))}
                            </div>
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="backtest-card telegram-card">
          <div className="backtest-card-head">
            <div>
              <h2>Telegram Alerts</h2>
            </div>
            <span className={`status ${telegramConfigured ? "sent" : "skipped"}`}>{telegramConfigured ? "configured" : "needs env"}</span>
          </div>
          <div className="telegram-grid" aria-label="Telegram environment status">
            <div>
              <span>Bot token</span>
              <strong>{process.env.TELEGRAM_BOT_TOKEN ? "Set" : "Missing"}</strong>
            </div>
            <div>
              <span>Group chat ID</span>
              <strong>{process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_CHAT_ID ? "Set" : "Missing"}</strong>
            </div>
            <div>
              <span>Route</span>
              <strong>/api/cron/check-signals</strong>
            </div>
          </div>
        </section>

        <section className="backtest-card telegram-card">
          <div className="backtest-card-head">
            <div>
              <h2>Runtime Storage</h2>
            </div>
            <span className={`status ${assetStore === "firebase" ? "sent" : "skipped"}`}>{assetStore}</span>
          </div>
          <div className="telegram-grid" aria-label="Runtime storage status">
            <div>
              <span>Alert store</span>
              <strong>{alertStore}</strong>
            </div>
            <div>
              <span>Backtest/data source</span>
              <strong>{assetStore}</strong>
            </div>
            <div>
              <span>Live-enabled sets</span>
              <strong>{fmtNumber(liveSelectionCount)}</strong>
            </div>
          </div>
        </section>

        <section className="backtest-card sync-card">
          <div className="backtest-card-head">
            <div>
              <h2>Sync</h2>
            </div>
            <span className="status sent">active</span>
          </div>
          <div className="sync-grid" aria-label="Dataset sync status">
            <div className={`dataset-sync-tile sync-state-${marketDataSyncState}`}>
              <span className="sync-tile-name">Market data sync</span>
              <dl className="sync-tile-times">
                <dt>Status</dt>
                <dd>
                  <SyncTileStatus
                    lastSuccessfulAt={syncStatus.lastMarketDataSyncAt ?? legacyDatasetSyncAt}
                    run={syncStatus.marketDataSync}
                    state={marketDataSyncState}
                  />
                </dd>
                <dt>Last</dt>
                <dd>
                  <LocalDateTime value={syncStatus.lastMarketDataSyncAt ?? legacyDatasetSyncAt} fallback="Not synced yet" />
                </dd>
                <dt>Next scheduled</dt>
                <dd>
                  <LocalDateTime value={nextMarketDataSyncAt} />
                </dd>
                <dt>Interval</dt>
                <dd>Every 5 minutes</dd>
              </dl>
            </div>
            <div className={`dataset-sync-tile sync-state-${signalTradeCheckState}`}>
              <span className="sync-tile-name">Signal trade check</span>
              <dl className="sync-tile-times">
                <dt>Status</dt>
                <dd>
                  <SyncTileStatus
                    lastSuccessfulAt={syncStatus.lastSignalTradeCheckAt}
                    run={syncStatus.signalTradeCheck}
                    state={signalTradeCheckState}
                  />
                </dd>
                <dt>Last</dt>
                <dd>
                  <LocalDateTime value={syncStatus.lastSignalTradeCheckAt} fallback="Not checked yet" />
                </dd>
                <dt>Next scheduled</dt>
                <dd>
                  <LocalDateTime value={nextSignalTradeCheckAt} />
                </dd>
                <dt>Interval</dt>
                <dd>Every 15 minutes</dd>
              </dl>
            </div>
            <div className={`dataset-sync-tile sync-state-${backtestBehindMarketData ? "failed" : latestTradeAt ? "success" : "idle"}`}>
              <span className="sync-tile-name">Backtest history</span>
              <dl className="sync-tile-times">
                <dt>Status</dt>
                <dd>{backtestBehindMarketData ? "Behind market data" : latestTradeAt ? "Current snapshot" : "No snapshot"}</dd>
                <dt>Latest trade</dt>
                <dd>
                  <LocalDateTime value={latestTradeAt} fallback="Unknown" />
                </dd>
                <dt>Manifest</dt>
                <dd>
                  <LocalDateTime value={backtestManifestAt} fallback="Unknown" />
                </dd>
                <dt>Data ends</dt>
                <dd>
                  <LocalDateTime value={dataEndsAt} fallback="Unknown" />
                </dd>
                <dt>Stored trades</dt>
                <dd>{fmtNumber(backtestFreshness.trades)}</dd>
              </dl>
            </div>
            <DataValidityBox dataValidity={dataValidity} />
          </div>
        </section>
        <nav className="researchBottomNav" aria-label="Research navigation">
          <Link className="terminal-action" href="/research">
            Research
          </Link>
        </nav>
      </section>
    </main>
  );
}
