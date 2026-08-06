import { writeFileSync } from "node:fs";
import path from "node:path";

import { assetForKey } from "../src/lib/assets";
import { buildLocalStrategyCatalog, type BacktestTrade } from "../src/lib/backtest";
import { analyzePropFirmChallenge, DEFAULT_CHALLENGE_RULES } from "../src/lib/challenge";
import { dollarPerUnit } from "../src/lib/instruments";
import { boundedTradeDollarPnl } from "../src/lib/live-trade-calculations";
import { enabledStrategyIdsForMarket, getLiveConfig, type DashboardMarket } from "../src/lib/live-config";

function tradeDollars(trade: BacktestTrade, riskCeiling: number): number {
  const size = trade.sizeMultiplierHint ?? 1;
  const unitValue = dollarPerUnit(trade.symbol, trade.entryPrice) * size;
  const risk = (Math.abs(trade.slUnits) + Math.abs(trade.costUnits)) * unitValue;
  const target = Math.abs(trade.tpUnits * unitValue);
  const raw = trade.netUnits * unitValue;
  const pnl = trade.managementEvents?.length ? raw : boundedTradeDollarPnl(raw, target, risk);
  if (!(risk > 0) || !(target > 0)) return pnl;
  const targetCeiling = riskCeiling * 5;
  const scale = Math.min(riskCeiling / risk, targetCeiling / target);
  return pnl * (Number.isFinite(scale) && scale > 0 ? Number(scale.toFixed(6)) : 1);
}

function horizon(summary: ReturnType<typeof analyzePropFirmChallenge>, key: "7d" | "14d") {
  return summary.monteCarloPassRates.find((row) => row.key === key)?.passRatePct ?? 0;
}

async function main() {
  const config = await getLiveConfig();
  const catalog = await buildLocalStrategyCatalog();
  const candidates: Record<DashboardMarket, number[]> = {
    forex: [250, 400, 550, 700, 800, 850, 900, 950, 1000],
    futures: [125, 200, 275, 350, 425, 500]
  };
  const reports = [];
  for (const market of ["forex", "futures"] as const) {
    const selected = new Set(enabledStrategyIdsForMarket(config, market));
    const trades = catalog.trades.filter((trade) => {
      const tradeMarket = assetForKey(catalog.entries.find((entry) => entry.key === trade.datasetId)!.assetKey).market;
      return selected.has(trade.datasetId) && (tradeMarket === "futures" ? "futures" : "forex") === market;
    });
    for (const riskCeiling of candidates[market]) {
      const replayTrades = trades.map((trade) => ({
        entryTime: trade.entryTime,
        key: trade.datasetId,
        pnlDollars: tradeDollars(trade, riskCeiling)
      }));
      const summary = analyzePropFirmChallenge(replayTrades, `challenge-sizing:${market}:${riskCeiling}`, DEFAULT_CHALLENGE_RULES);
      reports.push({
        avgMinutesToPass: summary.monteCarlo.avgMinutesToPass,
        eventualPassRatePct: summary.monteCarlo.passRatePct,
        historicalPassRatePct: summary.historical.passRatePct,
        market,
        medianMinutesToPass: summary.monteCarlo.medianMinutesToPass,
        medianTradesToPass: summary.monteCarlo.medianTradesToPass,
        monteCarlo14dPassRatePct: horizon(summary, "14d"),
        monteCarlo7dPassRatePct: horizon(summary, "7d"),
        riskCeiling,
        targetCeiling: riskCeiling * 5,
        trades: replayTrades.length
      });
    }
  }
  writeFileSync(path.join(process.cwd(), "Research", "reports", "challenge_sizing_optimization.json"), `${JSON.stringify(reports, null, 2)}\n`);
  console.log(JSON.stringify(reports, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
