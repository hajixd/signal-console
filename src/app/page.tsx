import ChallengeReplay from "@/components/challenge/challenge-replay";
import SelectedStrategyStats from "@/components/strategies/selected-strategy-stats";
import StrategySelector from "@/components/strategies/strategy-selector";
import EditableTradeHistory from "@/components/trades/editable-trade-history";
import { type TradeHistoryRow } from "@/components/trades/trade-history";
import ThemeToggle from "@/components/ui/theme-toggle";
import { aggregateBacktest, getBacktestStats, getBacktestTrades, type BacktestStat, type BacktestTrade } from "@/lib/backtest";
import { DEFAULT_CHALLENGE_RULES, type ChallengeRules } from "@/lib/challenge";
import { dollarPerUnit, instrumentSizeLabel, instrumentUnitLabel, recommendedSizeMultiplier } from "@/lib/instruments";
import { allRules } from "@/lib/signal-strategies";
import { strategyLabelAliases } from "@/lib/strategy-names";
import { getTrades } from "@/lib/storage";
import { TOPSTEP_100K_ACCOUNT, topstepMaxPositionSizeForSymbol, topstepSessionKey } from "@/lib/topstep";
import type { TradeAlert } from "@/lib/types";

export const dynamic = "force-dynamic";
const DEFAULT_SELECTED_STRATEGY_COUNT = 0;
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
  logicalKey: string;
  datasetId: string;
  datasetLabel: string;
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
  sizeLabel: string;
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

function computedStat(key: string, trades: BacktestTrade[]): BacktestStat | undefined {
  const scoped = trades.filter((trade) => trade.key === key);
  if (!scoped.length) return undefined;
  const aggregate = aggregateBacktest(scoped);
  const first = scoped[0]!;
  const avgTpUnits = scoped.reduce((sum, trade) => sum + trade.tpUnits, 0) / scoped.length;
  const avgSlUnits = scoped.reduce((sum, trade) => sum + trade.slUnits, 0) / scoped.length;
  const avgCostUnits = scoped.reduce((sum, trade) => sum + trade.costUnits, 0) / scoped.length;
  return {
    key: first.key,
    logicalKey: first.logicalKey,
    datasetId: first.datasetId,
    datasetLabel: first.datasetLabel,
    market: first.market,
    symbol: first.symbol,
    phase: first.phase,
    label: first.label,
    source: first.source,
    variantId: first.variantId,
    modelName: first.modelName,
    sizeMultiplier: recommendedSizeMultiplier({
      symbol: first.symbol,
      tpUnits: avgTpUnits,
      slUnits: avgSlUnits,
      costUnits: avgCostUnits
    }),
    trades: aggregate.trades,
    wins: aggregate.wins,
    losses: aggregate.losses,
    winRatePct: aggregate.winRatePct,
    profitFactor: aggregate.profitFactor,
    totalR: aggregate.totalR,
    avgR: aggregate.avgR,
    maxDrawdownR: 0,
    tradesPerDay: aggregate.trades / 730,
    tradesPerWeek: aggregate.trades / (730 / 7),
    pipOrTickSize: undefined,
    tpUnits: avgTpUnits,
    slUnits: avgSlUnits,
    costUnits: avgCostUnits,
    signalAtrMult: undefined,
    recentSignalLookback: undefined,
    absCloseEma200AtrMax: undefined,
    tradeRsiMin: undefined,
    tradeRsiMax: undefined
  };
}

function positiveMetric(value: number | undefined): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
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

function liveRowClass(trade: TradeAlert): string {
  return trade.side === "long" ? "up-row" : "down-row";
}

function tradeDollarPnl(trade: BacktestTrade, sizeMultiplier = 1): number {
  return trade.netUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * sizeMultiplier;
}

function tradeCostUnits(trade: BacktestTrade): number {
  return Math.max(0, trade.costUnits);
}

function tradeTargetDollars(trade: BacktestTrade, sizeMultiplier = 1): number {
  return Math.abs(trade.tpUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * sizeMultiplier);
}

function tradeRiskDollars(trade: BacktestTrade, sizeMultiplier = 1): number {
  const netRiskUnits = Math.abs(trade.slUnits) + tradeCostUnits(trade);
  return Math.abs(netRiskUnits * dollarPerUnit(trade.symbol, trade.entryPrice) * sizeMultiplier);
}

function isTopstepReplayEligible(trade: BacktestTrade, sizeMultiplier = 1): boolean {
  return (
    trade.market === "futures" &&
    sizeMultiplier <= topstepMaxPositionSizeForSymbol(trade.symbol) &&
    tradeRiskDollars(trade, sizeMultiplier) <= TOPSTEP_100K_ACCOUNT.maxPerTradeRisk &&
    tradeTargetDollars(trade, sizeMultiplier) < TOPSTEP_100K_ACCOUNT.bestDayRecommendation
  );
}

function tradeTargetPrice(trade: BacktestTrade, priceUnit: number): number {
  const direction = trade.side === "long" ? 1 : -1;
  return trade.entryPrice + direction * trade.tpUnits * priceUnit;
}

function tradeStopPrice(trade: BacktestTrade, priceUnit: number): number {
  const direction = trade.side === "long" ? 1 : -1;
  return trade.entryPrice - direction * trade.slUnits * priceUnit;
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
  const liveTrades = await getTrades();
  const backtestStats = await getBacktestStats();
  const backtestTrades = await getBacktestTrades();
  const liveRules = await allRules();
  const liveRuleByKey = new Map(liveRules.map((rule) => [rule.key, rule]));
  const statByKey = new Map(backtestStats.map((stat) => [stat.key, stat]));

  const rawOptionByKey = new Map<string, StrategyOption>();
  for (const stat of backtestStats) {
    const liveRule = liveRuleByKey.get(stat.logicalKey);
    const derivedStat = computedStat(stat.key, backtestTrades);
    const tpUnits = positiveMetric(stat.tpUnits) ?? positiveMetric(derivedStat?.tpUnits) ?? liveRule?.tpUnits ?? 0;
    const slUnits = positiveMetric(stat.slUnits) ?? positiveMetric(derivedStat?.slUnits) ?? liveRule?.slUnits ?? 0;
    const unitLabel = liveRule?.unitLabel ?? instrumentUnitLabel(stat.symbol);
    const baseDollarUnit = dollarPerUnit(stat.symbol);
    const baseSizeMultiplier = (positiveMetric(stat.sizeMultiplier) ?? positiveMetric(derivedStat?.sizeMultiplier) ?? liveRule?.sizeMultiplier ?? 1) * accountMultiplier;
    const sizeMultiplier = baseSizeMultiplier;
    rawOptionByKey.set(stat.key, {
      key: stat.key,
      logicalKey: stat.logicalKey,
      datasetId: stat.datasetId,
      datasetLabel: stat.datasetLabel,
      label: stat.label,
      aliases: strategyLabelAliases({
        symbol: stat.symbol,
        phase: stat.phase,
        source: stat.source,
        variantId: stat.variantId,
        mlModelName: stat.modelName
      }),
      symbol: stat.symbol,
      phase: stat.phase,
      market: stat.market,
      source: stat.source,
      variantId: stat.variantId,
      winRatePct: stat.winRatePct,
      profitFactor: stat.profitFactor,
      trades: stat.trades,
      tradesPerWeek: stat.tradesPerWeek,
      tpUnits,
      slUnits,
      unitLabel,
      dollarPerUnit: baseDollarUnit,
      sizeMultiplier,
      targetDollars: Math.abs(tpUnits * baseDollarUnit * sizeMultiplier),
      riskDollars: Math.abs(slUnits * baseDollarUnit * sizeMultiplier),
      sizeLabel: instrumentSizeLabel(stat.symbol, sizeMultiplier),
      liveSupported: Boolean(liveRule),
      stat
    });
  }

  const rawStrategyOptions = [...rawOptionByKey.values()];
  const duplicateLabels = new Map<string, number>();
  for (const option of rawStrategyOptions) {
    duplicateLabels.set(option.label, (duplicateLabels.get(option.label) ?? 0) + 1);
  }

  const strategyOptions = rawStrategyOptions
    .map((option) => {
      const label = (duplicateLabels.get(option.label) ?? 0) > 1 ? `${option.label} (${option.datasetLabel})` : option.label;
      return {
        ...option,
        label,
        aliases: [label, ...option.aliases.filter((alias) => alias !== label)]
      };
    })
    .sort((left, right) => {
    if (left.liveSupported !== right.liveSupported) return left.liveSupported ? -1 : 1;
    if (left.trades === 0 || right.trades === 0) return left.trades === right.trades ? 0 : left.trades ? -1 : 1;
    return right.profitFactor - left.profitFactor;
  });
  const optionByKey = new Map(strategyOptions.map((option) => [option.key, option]));
  const allKeys = strategyOptions.map((option) => option.key);
  const defaultSelectedKeys = allKeys.slice(0, DEFAULT_SELECTED_STRATEGY_COUNT);
  const selectedKeys = parseSelection(params?.strategies, allKeys, defaultSelectedKeys);
  const selectedKeySet = new Set(selectedKeys);
  const selectedLiveKeys = new Set(
    strategyOptions.filter((option) => selectedKeySet.has(option.key) && option.liveSupported).map((option) => option.logicalKey)
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
  const selectedBacktestTrades = backtestTrades.filter((trade) => selectedKeySet.has(trade.key));
  const selectedBasketTrades = selectedBacktestTrades.map((trade) => ({
    key: trade.key,
    entryTime: trade.entryTime,
    basePnlDollars: tradeDollarPnl(trade, optionByKey.get(trade.key)?.sizeMultiplier ?? 1)
  }));
  const visibleSelectedBacktestTrades = selectedBacktestTrades.slice(0, DEFAULT_TRADE_HISTORY_LIMIT);
  const tradeHistoryRows: TradeHistoryRow[] = visibleSelectedBacktestTrades.map((trade, index) => {
    const sizeMultiplier = optionByKey.get(trade.key)?.sizeMultiplier ?? 1;
    const dollarPnl = tradeDollarPnl(trade, sizeMultiplier);
    const unitLabel = instrumentUnitLabel(trade.symbol);
    const targetDollars = tradeTargetDollars(trade, sizeMultiplier);
    const riskDollars = tradeRiskDollars(trade, sizeMultiplier);
    const priceUnit = liveRuleByKey.get(trade.logicalKey)?.tickSize ?? statByKey.get(trade.key)?.pipOrTickSize ?? 1;
    const targetPrice = tradeTargetPrice(trade, priceUnit);
    const stopPrice = tradeStopPrice(trade, priceUnit);
    const targetMove = Math.abs(targetPrice - trade.entryPrice);
    const stopMove = Math.abs(stopPrice - trade.entryPrice);
    const dollarsPerPricePoint =
      targetMove > 0 ? targetDollars / targetMove : stopMove > 0 ? riskDollars / stopMove : dollarPerUnit(trade.symbol, trade.entryPrice);
    return {
      id: `${trade.key}-${trade.entryTime}-${index}`,
      strategyKey: trade.key,
      rowClassName: resultRowClass(dollarPnl),
      pnlClassName: resultClass(dollarPnl),
      pnlDollars: dollarPnl,
      indexLabel: fmtNumber(index + 1),
      symbol: trade.symbol,
      modelName: optionByKey.get(trade.key)?.label ?? trade.label,
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
      sizeLabel: instrumentSizeLabel(trade.symbol, sizeMultiplier),
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
  const challengeReplayTrades = selectedBacktestTrades
    .filter((trade) => isTopstepReplayEligible(trade, optionByKey.get(trade.key)?.sizeMultiplier ?? 1))
    .map((trade) => ({
      key: trade.key,
      entryTime: trade.entryTime,
      pnlDollars: tradeDollarPnl(trade, optionByKey.get(trade.key)?.sizeMultiplier ?? 1)
    }));
  const challengeReplaySeed = `signal-console:${selectedKeys.join("|")}`;
  const challengeHistoricalSessions = challengeSessionCount(challengeReplayTrades);
  const telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const telegramLink = telegramBotUsername ? `https://t.me/${telegramBotUsername}` : "https://t.me/BotFather";

  return (
    <main className="terminal">
      <section className="terminal-workspace" id="signals">
        <header className="terminal-head">
          <div className="asset-meta">
            <h1>Signal Console</h1>
          </div>
          <div className="terminal-actions">
            <ThemeToggle />
            <a className="terminal-action" href={telegramLink} target="_blank" rel="noreferrer">
              {telegramBotUsername ? "Add Telegram bot" : "Open BotFather"}
            </a>
          </div>
        </header>

        <section className="backtest-card">
          <div className="backtest-card-head">
            <div>
              <h2>Strategies</h2>
            </div>
            <span className="count-pill">
              {fmtNumber(strategyOptions.length)} strategies / {fmtNumber(selectedBacktestTrades.length)} trades
            </span>
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
              <strong>/api/cron/check-trades</strong>
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
