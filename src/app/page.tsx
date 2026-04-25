import ChallengeReplay from "@/components/challenge/challenge-replay";
import SelectedStrategyStats from "@/components/strategies/selected-strategy-stats";
import StrategySelector from "@/components/strategies/strategy-selector";
import EditableTradeHistory from "@/components/trades/editable-trade-history";
import { type TradeHistoryRow } from "@/components/trades/trade-history";
import ThemeToggle from "@/components/ui/theme-toggle";
import {
  aggregateBacktest,
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
import { getDatasetStatus, getLiveConfig } from "@/lib/live-config";
import { allRules } from "@/lib/live-signals";
import { projectAssetMode } from "@/lib/project-assets";
import { getTrades, storageMode } from "@/lib/storage";
import { topstepSessionKey } from "@/lib/topstep";
import type { TradeAlert } from "@/lib/types";

export const dynamic = "force-dynamic";
const DEFAULT_SELECTED_STRATEGY_COUNT = 1;
const DEFAULT_TRADE_HISTORY_LIMIT = 200;

type HomeProps = {
  searchParams?: Promise<{
    strategies?: string;
    accountSize?: string;
    profitTarget?: string;
    maxLoss?: string;
    dailyLoss?: string;
    dailyLock?: string;
    dailyStop?: string;
  }>;
};

type StrategyOption = {
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
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

function syncStatusLabel(value: string | undefined): string {
  if (!value || value.startsWith("1970-01-01")) return "Not synced yet";
  return fmtTime(value);
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

function challengeRulesFromParams(params: Awaited<HomeProps["searchParams"]> | undefined): ChallengeRules {
  return {
    startingBalance: numericParam(params?.accountSize, DEFAULT_CHALLENGE_RULES.startingBalance, 1),
    profitTarget: numericParam(params?.profitTarget, DEFAULT_CHALLENGE_RULES.profitTarget, 1),
    maximumLossLimit: numericParam(params?.maxLoss, DEFAULT_CHALLENGE_RULES.maximumLossLimit),
    dailyLossLimit: numericParam(params?.dailyLoss, DEFAULT_CHALLENGE_RULES.dailyLossLimit),
    dailyProfitLock: numericParam(params?.dailyLock, DEFAULT_CHALLENGE_RULES.dailyProfitLock),
    dailyLossStop: numericParam(params?.dailyStop, DEFAULT_CHALLENGE_RULES.dailyLossStop)
  };
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

function liveRowClass(trade: TradeAlert): string {
  return trade.side === "long" ? "up-row" : "down-row";
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

function recentStrategyTrades(trades: BacktestTrade[]): BacktestTrade[] {
  return [...trades]
    .sort((left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime))
    .slice(0, 2);
}

function sameRecentDisplay(values: string[]): boolean {
  return values.length < 2 || values[0] === values[1];
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
  const challengeRules = challengeRulesFromParams(params);
  const accountMultiplier = accountSizeMultiplier(challengeRules);
  const [liveTrades, strategyCatalog, backtestStats, backtestTrades, liveRules, liveConfig, datasetStatus] = await Promise.all([
    getTrades(),
    getStrategyCatalog(),
    getBacktestStats(),
    getBacktestTrades(),
    allRules(),
    getLiveConfig(),
    getDatasetStatus()
  ]);
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

  const strategyOptions = strategyCatalog
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
        [...stats.map((stat) => stat.market), ...trades.map((trade) => trade.market)].filter((value): value is string => Boolean(value))
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
        label: entry.label,
        aliases: uniqueValues([
          entry.label,
          entry.symbol,
          ...entry.timeframes,
          entry.market,
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
        market: markets.length === 1 ? markets[0] : markets.length > 1 ? "multi" : entry.market,
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
  const optionByKey = new Map(strategyOptions.map((option) => [option.key, option]));
  const allKeys = strategyOptions.map((option) => option.key);
  const persistedSelectedKeys = liveConfig.dashboardSelectedDatasetIds.filter((key) => allKeys.includes(key));
  const defaultSelectedKeys = persistedSelectedKeys.length ? persistedSelectedKeys : allKeys.slice(0, DEFAULT_SELECTED_STRATEGY_COUNT);
  const selectedKeys = parseSelection(params?.strategies, allKeys, defaultSelectedKeys);
  const selectedKeySet = new Set(selectedKeys);
  const selectedLiveKeys = new Set(
    strategyOptions.filter((option) => selectedKeySet.has(option.key) && option.liveSupported).flatMap((option) => option.logicalKeys)
  );
  const selectedStrategyNames = new Set(
    strategyOptions
      .filter((option) => selectedKeySet.has(option.key))
      .flatMap((option) => option.aliases)
  );
  const selectedLiveTrades = liveTrades.filter(
    (trade) =>
      (trade.strategyKey && selectedLiveKeys.has(trade.strategyKey)) ||
      (trade.logicalStrategyKey && selectedLiveKeys.has(trade.logicalStrategyKey)) ||
      selectedStrategyNames.has(trade.strategy)
  );
  const selectedBacktestTrades = backtestTrades.filter((trade) => selectedKeySet.has(trade.datasetId));
  const selectedBasketTrades = selectedBacktestTrades.map((trade) => ({
    key: trade.datasetId,
    entryTime: trade.entryTime,
    basePnlDollars: tradeDollarPnl(trade, optionByKey.get(trade.datasetId)?.sizeMultiplier ?? 1),
    rMultiple: trade.rMultiple
  }));
  const visibleSelectedBacktestTrades = selectedBacktestTrades.slice(0, DEFAULT_TRADE_HISTORY_LIMIT);
  const tradeHistoryRows: TradeHistoryRow[] = visibleSelectedBacktestTrades.map((trade, index) => {
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
      marketLabel: trade.market ? trade.market.replaceAll("_", " ") : "Market",
      market: trade.market,
      side: trade.side,
      sideLabel: sideLabel(trade.side),
      sideClassName: sideClass(trade.side),
      entryIndex: trade.entryIndex,
      exitIndex: trade.exitIndex,
      signalTime: trade.signalTime,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
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
  const visibleTradeHistoryRows = tradeHistoryRows;
  const challengeReplayTrades = selectedBacktestTrades.map((trade) => ({
      key: trade.datasetId,
      entryTime: trade.entryTime,
      pnlDollars: tradeDollarPnl(trade, optionByKey.get(trade.datasetId)?.sizeMultiplier ?? 1)
    }));
  const challengeReplaySeed = `trading-bot:${selectedKeys.join("|")}`;
  const challengeHistoricalSessions = challengeSessionCount(challengeReplayTrades);
  const telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const telegramLink = telegramBotUsername ? `https://t.me/${telegramBotUsername}` : "https://t.me/BotFather";
  const alertStore = storageMode();
  const assetStore = projectAssetMode();
  const liveSelectionCount = liveConfig.enabledDatasetIds.length || liveRules.length;

  return (
    <main className="terminal">
      <section className="terminal-workspace" id="signals">
        <header className="terminal-head">
          <div className="asset-meta">
            <h1>Trading Bot</h1>
          </div>
          <div className="terminal-actions">
            <ThemeToggle />
            <a className="terminal-action" href={telegramLink} target="_blank" rel="noreferrer">
              {telegramBotUsername ? "Open Telegram bot" : "Open BotFather"}
            </a>
          </div>
        </header>

        <section className="backtest-card">
          <div className="backtest-card-head">
            <div>
              <h2>Strategies</h2>
            </div>
            <span className="count-pill">{fmtNumber(strategyOptions.length)} strategies / {fmtNumber(selectedBacktestTrades.length)} trades</span>
          </div>

          <SelectedStrategyStats strategies={strategyOptions} trades={selectedBasketTrades} />

          <StrategySelector strategies={strategyOptions} selectedKeys={selectedKeys} defaultKeys={defaultSelectedKeys} />
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
          <ChallengeReplay initialRules={challengeRules} seedPrefix={challengeReplaySeed} strategies={strategyOptions} trades={challengeReplayTrades} />
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
              <span>Chat ID</span>
              <strong>{process.env.TELEGRAM_CHAT_ID ? "Set" : "Missing"}</strong>
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
            <div>
              <span>Dataset sync</span>
              <strong>{syncStatusLabel(datasetStatus?.lastSyncAt)}</strong>
            </div>
          </div>
        </section>

        <section className="backtest-card history-card" id="cron" aria-label="Cron execution history">
          <div className="backtest-card-head">
            <div>
              <h2>Cron Executions</h2>
              <p>Live alerts generated by the selected strategies.</p>
            </div>
            <span className="count-pill">Showing {fmtNumber(selectedLiveTrades.length)} alerts</span>
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
                  <col className="live-col-direction" />
                  <col className="live-col-price" />
                  <col className="live-col-price" />
                  <col className="live-col-price" />
                  <col className="live-col-money" />
                  <col className="live-col-money" />
                  <col className="live-col-odds" />
                  <col className="live-col-status" />
                  <col className="live-col-time" />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Ticker</th>
                    <th>Model</th>
                    <th>Direction</th>
                    <th>Entry</th>
                    <th>Take Profit</th>
                    <th>Stop Loss</th>
                    <th>Target $</th>
                    <th>Risk $</th>
                    <th>Odds</th>
                    <th>Telegram</th>
                    <th>Signal time</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedLiveTrades.map((trade, index) => (
                    <tr className={liveRowClass(trade)} key={trade.id}>
                      <td>{fmtNumber(index + 1)}</td>
                      <td className="ticker-cell">{trade.symbol}</td>
                      <td className="main-cell">
                        <span>{trade.strategy}</span>
                        <small>{trade.entryMode}</small>
                      </td>
                      <td>
                        <span className={sideClass(trade.side)}>{sideLabel(trade.side)}</span>
                      </td>
                      <td>{fmtDollarPrice(trade.entryPrice)}</td>
                      <td>{fmtPrice(trade.takeProfitPrice)}</td>
                      <td>{fmtPrice(trade.stopLossPrice)}</td>
                      <td>{fmtMoney(alertTargetDollars(trade))}</td>
                      <td>{fmtMoney(alertRiskDollars(trade))}</td>
                      <td>{fmtPct(trade.estimatedWinRatePct)}</td>
                      <td>
                        <span className={`status ${trade.telegramStatus}`}>{trade.telegramStatus}</span>
                      </td>
                      <td>{fmtTime(trade.signalTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="backtest-card history-card" id="backtest" aria-label="Backtest trade history">
          <div className="backtest-card-head">
            <div>
              <h2>Backtest History</h2>
              <p>Trade-by-trade dollar history for the selected strategies. Loading the most recent trades first keeps the page fast.</p>
            </div>
            <span className="count-pill">
              Showing {fmtNumber(visibleTradeHistoryRows.length)} of {fmtNumber(selectedBacktestTrades.length)} trades
            </span>
          </div>

          {selectedBacktestTrades.length === 0 ? (
            <div className="empty-state">
              <strong>No backtest trades match</strong>
              <span>Select at least one strategy to see historical trades.</span>
            </div>
          ) : (
            <EditableTradeHistory rows={visibleTradeHistoryRows} strategies={strategyOptions} />
          )}
        </section>
      </section>
    </main>
  );
}
