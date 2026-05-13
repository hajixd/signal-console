import { NextRequest, NextResponse } from "next/server";
import { executeAutoTrade } from "@/lib/auto-trader";
import { autoTradeMarketForSignal } from "@/lib/auto-trade-platforms";
import { dollarPerUnit } from "@/lib/instruments";
import { fetchStoredAssetBars, fetchStoredMarketBars } from "@/lib/market-data-store";
import { saveCronRun, updateDatasetSyncRunStatus } from "@/lib/live-config";
import { activeRules, evaluateLatestSignal } from "@/lib/live-signals";
import { getTrades, hasTrade, saveTrade } from "@/lib/storage";
import { sendTelegram, sendTelegramOutcome } from "@/lib/telegram";
import { TOPSTEP_100K_ACCOUNT, reviewTopstepSignal, withTopstepGuardNote } from "@/lib/topstep";
import type { Bar, CronResult, TradeAlert } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown signal check error";
}

function signalDollars(trade: TradeAlert): { targetDollars: number; riskDollars: number } {
  const unitValue = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = trade.sizeMultiplier ?? 1;
  return {
    riskDollars: Math.abs(trade.slUnits * unitValue * sizeMultiplier),
    targetDollars: Math.abs(trade.tpUnits * unitValue * sizeMultiplier)
  };
}

type TradeLifecycleHit = {
  pnlDollars: number;
  price: number;
  rMultiple: number;
  status: "take_profit" | "stop_loss";
  time: string;
};

function lifecycleLookbackMs(): number {
  const hours = Number(process.env.TELEGRAM_TRADE_UPDATE_LOOKBACK_HOURS ?? 72);
  return (Number.isFinite(hours) && hours > 0 ? hours : 72) * 60 * 60_000;
}

function tradeLifecycleHit(trade: TradeAlert, bars: Bar[]): TradeLifecycleHit | null {
  const signalTime = Date.parse(trade.signalTime);
  const trackedBars = bars.filter((bar) => Date.parse(bar.time) > signalTime);
  if (!trackedBars.length) return null;
  const dollars = signalDollars(trade);
  const rewardRisk = dollars.riskDollars > 0 ? dollars.targetDollars / dollars.riskDollars : 0;

  for (const bar of trackedBars) {
    const hitTakeProfit =
      trade.side === "long" ? bar.high >= trade.takeProfitPrice : bar.low <= trade.takeProfitPrice;
    const hitStopLoss =
      trade.side === "long" ? bar.low <= trade.stopLossPrice : bar.high >= trade.stopLossPrice;

    if (!hitTakeProfit && !hitStopLoss) continue;

    const status = hitStopLoss ? "stop_loss" : "take_profit";
    return {
      pnlDollars: status === "take_profit" ? dollars.targetDollars : -dollars.riskDollars,
      price: status === "take_profit" ? trade.takeProfitPrice : trade.stopLossPrice,
      rMultiple: status === "take_profit" ? rewardRisk : -1,
      status,
      time: bar.time
    };
  }

  return null;
}

async function notifyTradeLifecycles(result: CronResult, barsByAssetKey: Map<string, Bar[]>): Promise<void> {
  const oldestSignalTime = Date.now() - lifecycleLookbackMs();
  const openTrades = (await getTrades()).filter(
    (trade) =>
      trade.status === "alerted" &&
      !trade.lifecycleNotifiedAt &&
      trade.lifecycleStatus !== "take_profit" &&
      trade.lifecycleStatus !== "stop_loss" &&
      (Date.parse(trade.signalTime) || 0) >= oldestSignalTime &&
      Boolean(trade.assetKey)
  );

  for (const trade of openTrades) {
    try {
      const assetKey = trade.assetKey!;
      let bars = barsByAssetKey.get(assetKey);
      if (!bars) {
        bars = await fetchStoredAssetBars(assetKey);
        barsByAssetKey.set(assetKey, bars);
      }

      const hit = tradeLifecycleHit(trade, bars);
      if (!hit) continue;

      const updatedTrade: TradeAlert = {
        ...trade,
        lifecycleNotifiedAt: new Date().toISOString(),
        lifecyclePnlDollars: hit.pnlDollars,
        lifecyclePrice: hit.price,
        lifecycleRMultiple: hit.rMultiple,
        lifecycleStatus: hit.status,
        lifecycleTime: hit.time
      };
      const notification = await sendTelegramOutcome(updatedTrade);
      await saveTrade({
        ...updatedTrade,
        telegramLifecycleError: notification.error,
        telegramLifecycleStatus: notification.status
      });
    } catch (error) {
      result.errors.push({
        symbol: trade.symbol,
        message: `Trade lifecycle check failed: ${errorMessage(error)}`
      });
    }
  }
}

function genericSignalScore(trade: TradeAlert, riskDollars: number, targetDollars: number): number {
  const boundedProfitFactor = Number.isFinite(trade.liveProfitFactor) ? Math.min(Math.max(trade.liveProfitFactor, 0), 6) : 1;
  const rewardRisk = riskDollars > 0 ? targetDollars / riskDollars : 0;
  return trade.estimatedWinRatePct / 50 + Math.log1p(boundedProfitFactor) + Math.min(rewardRisk, 4) * 0.18;
}

function recordAssetTiming(
  timings: Map<string, { assetKey: string; durationMs: number; rules: number; symbol: string }>,
  rule: { assetKey: string; symbol: string },
  durationMs: number
): void {
  const current = timings.get(rule.assetKey) ?? {
    assetKey: rule.assetKey,
    durationMs: 0,
    rules: 0,
    symbol: rule.symbol
  };
  current.durationMs += durationMs;
  current.rules += 1;
  timings.set(rule.assetKey, current);
}

async function runSignalCheck(): Promise<CronResult> {
  const result: CronResult = {
    checkedAt: new Date().toISOString(),
    generated: [],
    skippedDuplicates: [],
    skippedRisk: [],
    errors: []
  };
  const candidates: Array<{ signal: ReturnType<typeof withTopstepGuardNote>; score: number; riskDollars: number }> = [];
  const rules = await activeRules();
  if (!rules.length) {
    throw new Error("No active live strategies are enabled for signal checks.");
  }

  const barsByAssetKey = new Map<string, Bar[]>();
  const assetTimings = new Map<string, { assetKey: string; durationMs: number; rules: number; symbol: string }>();

  for (const rule of rules) {
    const ruleStartedAt = Date.now();
    try {
      let bars = barsByAssetKey.get(rule.assetKey);
      if (!bars) {
        bars = await fetchStoredMarketBars(rule);
        barsByAssetKey.set(rule.assetKey, bars);
      }
      const signal = evaluateLatestSignal(rule, bars);
      if (!signal) continue;

      if (await hasTrade(signal.id)) {
        result.skippedDuplicates.push(signal.id);
        continue;
      }

      const signalMarket = autoTradeMarketForSignal(signal.market);
      if (!signalMarket) {
        result.skippedRisk.push({
          id: signal.id,
          symbol: signal.symbol,
          reason: `no auto-trade market route for ${signal.market}`
        });
        continue;
      }

      const topstepReview = signalMarket === "futures" ? reviewTopstepSignal(rule, signal) : null;
      if (topstepReview && !topstepReview.allowed) {
        result.skippedRisk.push({
          id: signal.id,
          symbol: signal.symbol,
          reason: topstepReview.reason ?? "Futures risk guard rejected the signal"
        });
        continue;
      }

      const dollars = topstepReview ?? signalDollars(signal);
      candidates.push({
        signal: topstepReview ? withTopstepGuardNote(signal, topstepReview) : signal,
        score: topstepReview?.score ?? genericSignalScore(signal, dollars.riskDollars, dollars.targetDollars),
        riskDollars: dollars.riskDollars
      });
    } catch (error) {
      result.errors.push({
        symbol: rule.symbol,
        message: error instanceof Error ? error.message : "Unknown error"
      });
    } finally {
      recordAssetTiming(assetTimings, rule, Date.now() - ruleStartedAt);
    }
  }

  result.assetTimings = [...assetTimings.values()];

  const configuredMaxAlerts = Number(process.env.AUTO_TRADE_MAX_ALERTS_PER_CHECK ?? process.env.TOPSTEP_MAX_ALERTS_PER_CHECK ?? TOPSTEP_100K_ACCOUNT.maxAlertsPerCheck);
  const configuredMaxRisk = Number(process.env.AUTO_TRADE_MAX_RISK_PER_CHECK ?? process.env.TOPSTEP_MAX_RISK_PER_CHECK ?? TOPSTEP_100K_ACCOUNT.maxRiskPerCheck);
  const maxAlerts = Number.isFinite(configuredMaxAlerts) && configuredMaxAlerts > 0 ? configuredMaxAlerts : TOPSTEP_100K_ACCOUNT.maxAlertsPerCheck;
  const maxRisk = Number.isFinite(configuredMaxRisk) && configuredMaxRisk > 0 ? configuredMaxRisk : TOPSTEP_100K_ACCOUNT.maxRiskPerCheck;
  let acceptedRisk = 0;
  let acceptedCount = 0;

  const selected = candidates
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => {
      if (acceptedCount >= maxAlerts) {
        result.skippedRisk.push({
          id: candidate.signal.id,
          symbol: candidate.signal.symbol,
          reason: `lower-ranked concurrent signal; ${maxAlerts} alert limit for this check`
        });
        return false;
      }
      if (acceptedRisk + candidate.riskDollars > maxRisk) {
        result.skippedRisk.push({
          id: candidate.signal.id,
          symbol: candidate.signal.symbol,
          reason: `would exceed ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(maxRisk)} risk budget for this check`
        });
        return false;
      }
      acceptedRisk += candidate.riskDollars;
      acceptedCount += 1;
      return true;
    });

  for (const candidate of selected) {
    await saveTrade({
      ...candidate.signal,
      autoTradeCheckedAt: new Date().toISOString(),
      autoTradeError: "Auto-trade execution queued; awaiting connector dispatch.",
      autoTradeStatus: "skipped"
    });
    const autoTrade = await executeAutoTrade(candidate.signal);
    const executableSignal = {
      ...candidate.signal,
      autoTradeAccountId: autoTrade.accountId,
      autoTradeAccountName: autoTrade.accountName,
      autoTradeCheckedAt: autoTrade.checkedAt,
      autoTradeContractId: autoTrade.contractId,
      autoTradeContractName: autoTrade.contractName,
      autoTradeCustomTag: autoTrade.customTag,
      autoTradeError: autoTrade.error,
      autoTradeOrderId: autoTrade.orderId,
      autoTradeOrders: autoTrade.orders,
      autoTradeProviderId: autoTrade.providerId,
      autoTradeProviderName: autoTrade.providerName,
      autoTradeStatus: autoTrade.status
    };
    await saveTrade(executableSignal);
    const notification = await sendTelegram(executableSignal);
    const trade = {
      ...executableSignal,
      telegramStatus: notification.status,
      telegramError: notification.error
    };
    await saveTrade(trade);
    result.generated.push(trade);
  }

  await notifyTradeLifecycles(result, barsByAssetKey);

  return result;
}

export async function GET(request: NextRequest) {
  const auth = isAuthorized(request);
  if (auth === "missing-secret") {
    return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500 });
  }
  if (auth === "bad-secret") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get("health") === "1") {
    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      ok: true,
      route: "/api/cron/check-signals"
    });
  }
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  await updateDatasetSyncRunStatus("signalTradeCheck", {
    error: undefined,
    finishedAt: undefined,
    startedAt: startedAtIso,
    state: "running"
  }).catch((error) => console.error("Failed to mark signal check running", error));

  try {
    const result = await runSignalCheck();
    await saveCronRun(result);
    const durationMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();
    const failed = result.errors.length > 0;

    await updateDatasetSyncRunStatus("signalTradeCheck", {
      durationMs,
      error: failed ? result.errors.map((entry) => `${entry.symbol}: ${entry.message}`).join("; ") : undefined,
      finishedAt,
      startedAt: startedAtIso,
      state: failed ? "failed" : "success"
    }).catch((error) => console.error("Failed to mark signal check finished", error));

    console.info("check-signals cron completed", {
      assetTimings: result.assetTimings,
      durationMs,
      errors: result.errors.length,
      generated: result.generated.length,
      skippedDuplicates: result.skippedDuplicates.length,
      skippedRisk: result.skippedRisk.length
    });
    return NextResponse.json(result);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = errorMessage(error);
    await updateDatasetSyncRunStatus("signalTradeCheck", {
      durationMs,
      error: message,
      finishedAt: new Date().toISOString(),
      startedAt: startedAtIso,
      state: "failed"
    }).catch((statusError) => console.error("Failed to mark signal check failed", statusError));
    console.error("check-signals cron failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
