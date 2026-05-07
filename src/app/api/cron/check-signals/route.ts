import { NextRequest, NextResponse } from "next/server";
import { executeAutoTrade } from "@/lib/auto-trader";
import { autoTradeMarketForSignal } from "@/lib/auto-trade-platforms";
import { dollarPerUnit } from "@/lib/instruments";
import { fetchMarketBars } from "@/lib/market-data";
import { refreshMarketDataForRules } from "@/lib/market-data-refresh";
import { saveCronRun } from "@/lib/live-config";
import { activeRules, evaluateLatestSignal } from "@/lib/live-signals";
import { hasTrade, saveTrade } from "@/lib/storage";
import { sendTelegram } from "@/lib/telegram";
import { TOPSTEP_100K_ACCOUNT, reviewTopstepSignal, withTopstepGuardNote } from "@/lib/topstep";
import type { CronResult, TradeAlert } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

function signalDollars(trade: TradeAlert): { targetDollars: number; riskDollars: number } {
  const unitValue = dollarPerUnit(trade.symbol, trade.entryPrice);
  const sizeMultiplier = trade.sizeMultiplier ?? 1;
  return {
    riskDollars: Math.abs(trade.slUnits * unitValue * sizeMultiplier),
    targetDollars: Math.abs(trade.tpUnits * unitValue * sizeMultiplier)
  };
}

function genericSignalScore(trade: TradeAlert, riskDollars: number, targetDollars: number): number {
  const boundedProfitFactor = Number.isFinite(trade.liveProfitFactor) ? Math.min(Math.max(trade.liveProfitFactor, 0), 6) : 1;
  const rewardRisk = riskDollars > 0 ? targetDollars / riskDollars : 0;
  return trade.estimatedWinRatePct / 50 + Math.log1p(boundedProfitFactor) + Math.min(rewardRisk, 4) * 0.18;
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
  const dataRefreshEnabled = process.env.CRON_REFRESH_MARKET_DATA !== "false";
  const refreshedBars = dataRefreshEnabled ? await refreshMarketDataForRules(rules) : null;
  if (refreshedBars) {
    result.dataRefresh = refreshedBars.summary;
  }

  for (const rule of rules) {
    try {
      const bars = refreshedBars?.barsByAssetKey.get(rule.assetKey) ?? (await fetchMarketBars(rule));
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
    }
  }

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
  const result = await runSignalCheck();
  await saveCronRun(result);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  return GET(request);
}
