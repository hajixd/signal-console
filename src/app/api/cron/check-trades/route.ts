import { NextRequest, NextResponse } from "next/server";
import { fetchMarketBars } from "@/lib/market-data";
import { activeRules, evaluateLatestSignal } from "@/lib/signal-strategies";
import { hasTrade, saveTrade } from "@/lib/storage";
import { sendTelegram } from "@/lib/telegram";
import { TOPSTEP_100K_ACCOUNT, reviewTopstepSignal, withTopstepGuardNote } from "@/lib/topstep";
import type { CronResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: NextRequest): "ok" | "missing-secret" | "bad-secret" {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "production" ? "missing-secret" : "ok";
  return request.headers.get("authorization") === `Bearer ${secret}` ? "ok" : "bad-secret";
}

async function runTradeCheck(): Promise<CronResult> {
  const result: CronResult = {
    checkedAt: new Date().toISOString(),
    generated: [],
    skippedDuplicates: [],
    skippedRisk: [],
    errors: []
  };
  const candidates: Array<{ signal: ReturnType<typeof withTopstepGuardNote>; score: number; riskDollars: number }> = [];
  const rules = await activeRules();

  for (const rule of rules) {
    try {
      const bars = await fetchMarketBars(rule);
      const signal = evaluateLatestSignal(rule, bars);
      if (!signal) continue;

      if (await hasTrade(signal.id)) {
        result.skippedDuplicates.push(signal.id);
        continue;
      }

      const topstepReview = reviewTopstepSignal(rule, signal);
      if (!topstepReview.allowed) {
        result.skippedRisk.push({
          id: signal.id,
          symbol: signal.symbol,
          reason: topstepReview.reason ?? "Topstep risk guard rejected the signal"
        });
        continue;
      }

      candidates.push({
        signal: withTopstepGuardNote(signal, topstepReview),
        score: topstepReview.score,
        riskDollars: topstepReview.riskDollars
      });
    } catch (error) {
      result.errors.push({
        symbol: rule.symbol,
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  const configuredMaxAlerts = Number(process.env.TOPSTEP_MAX_ALERTS_PER_CHECK ?? TOPSTEP_100K_ACCOUNT.maxAlertsPerCheck);
  const configuredMaxRisk = Number(process.env.TOPSTEP_MAX_RISK_PER_CHECK ?? TOPSTEP_100K_ACCOUNT.maxRiskPerCheck);
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
    const notification = await sendTelegram(candidate.signal);
    const trade = {
      ...candidate.signal,
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
  return NextResponse.json(await runTradeCheck());
}

export async function POST(request: NextRequest) {
  return GET(request);
}
