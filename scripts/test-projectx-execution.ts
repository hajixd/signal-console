import { executeAutoTrade } from "../src/lib/auto-trader";
import { getTrades } from "../src/lib/storage";
import { sendTelegramText } from "../src/lib/telegram";
import type { AutoTradeOrderSummary, TradeAlert } from "../src/lib/types";

const LIVE_CONFIRMATION = "I_UNDERSTAND_THIS_PLACES_A_REAL_ORDER";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wholePositive(value: number | undefined, fallback: number): number {
  const rounded = Math.round(Math.abs(value ?? fallback));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : fallback;
}

function shortOrder(order: AutoTradeOrderSummary): string {
  const account = order.accountName ?? String(order.accountId);
  const size = order.size ?? 0;
  const contract = order.contractName ?? order.contractId ?? "contract";
  const error = order.error ? ` - ${order.error}` : "";
  return `${account}: ${order.status}, size ${size}, ${contract}${error}`;
}

function baseSmokeTrade(): TradeAlert {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    entryMode: "ProjectX dry-run smoke",
    entryPrice: 6000,
    entryType: "market",
    estimatedWinRatePct: 50,
    id: `projectx_execution_smoke_seed_${Date.now()}`,
    liveProfitFactor: 1,
    market: "futures",
    side: "long",
    signalTime: now,
    slUnits: 10,
    status: "skipped",
    stopLossPrice: 5997.5,
    strategy: "ProjectX execution smoke",
    symbol: "ES",
    takeProfitPrice: 6005,
    telegramStatus: "skipped",
    tpUnits: 20,
    unitLabel: "ticks"
  };
}

function belowMinimumSize(result: Awaited<ReturnType<typeof executeAutoTrade>>): boolean {
  const orders = result.orders ?? [];
  return result.status === "skipped" && orders.length > 0 && orders.every((order) => order.status === "skipped" && order.error?.toLowerCase().includes("below 1 contract"));
}

function pickTrade(trades: TradeAlert[]): TradeAlert {
  const failedProjectX = trades.find(
    (trade) =>
      trade.market === "futures" &&
      (trade.autoTradeProviderId === "projectx" ||
        trade.autoTradeProviderName?.toLowerCase().includes("projectx") ||
        trade.autoTradeOrders?.some((order) => order.providerId === "projectx" || order.providerName?.toLowerCase().includes("projectx"))) &&
      (trade.autoTradeStatus === "failed" || trade.autoTradeOrders?.some((order) => order.status === "failed"))
  );
  return failedProjectX ?? trades.find((trade) => trade.market === "futures") ?? baseSmokeTrade();
}

async function main(): Promise<void> {
  const live = process.argv.includes("--live");
  if (live && process.env.CONFIRM_LIVE_PROJECTX_TEST !== LIVE_CONFIRMATION) {
    throw new Error(`Refusing live ProjectX order. Set CONFIRM_LIVE_PROJECTX_TEST=${LIVE_CONFIRMATION} and pass --live to place a real size-1 order.`);
  }

  process.env.AUTO_TRADE_FUTURES_PROVIDER ??= "projectx";
  process.env.PROJECTX_AUTO_TRADE_ENABLED ??= "1";
  if (!live) process.env.PROJECTX_AUTO_TRADE_DRY_RUN = "1";

  const base = pickTrade(await getTrades());
  const now = new Date().toISOString();
  const slUnits = wholePositive(base.slUnits, 10);
  const tpUnits = Math.max(wholePositive(base.tpUnits, slUnits * 2), slUnits * 2);
  const sizeCandidates = live ? [2] : [1, 2, 3, 4, 8, 16];
  let testTrade: TradeAlert | undefined;
  let result: Awaited<ReturnType<typeof executeAutoTrade>> | undefined;

  for (const sizeMultiplier of sizeCandidates) {
    testTrade = {
      ...base,
      autoTradeError: undefined,
      autoTradeOrders: undefined,
      autoTradeStatus: undefined,
      createdAt: now,
      entryType: "market",
      id: `projectx_execution_smoke_${Date.now()}_${sizeMultiplier}`,
      orderLeg: undefined,
      signalTime: now,
      sizeMultiplier,
      slUnits,
      splitOrderTotalSizeMultiplier: undefined,
      status: "skipped",
      telegramStatus: "skipped",
      tpUnits
    };
    result = await executeAutoTrade(testTrade);
    if (!belowMinimumSize(result)) break;
  }

  if (!testTrade || !result) throw new Error("ProjectX execution smoke did not run.");

  const lines = [
    "<b>NGL ProjectX execution smoke</b>",
    live ? "<b>LIVE SIZE-1 ORDER TEST</b>" : "<b>DRY RUN - no order placed</b>",
    `${escapeHtml(testTrade.symbol)} ${escapeHtml(testTrade.side)} | RR ${(tpUnits / slUnits).toFixed(2)}R | base size ${testTrade.sizeMultiplier}`,
    `Status: <b>${escapeHtml(result.status)}</b>`,
    result.contractName || result.contractId ? `Contract: ${escapeHtml(result.contractName ?? result.contractId ?? "")}` : undefined,
    result.error ? `Note: ${escapeHtml(result.error)}` : undefined,
    result.orders?.length ? "" : undefined,
    ...(result.orders ?? []).slice(0, 6).map((order) => escapeHtml(shortOrder(order)))
  ].filter((line): line is string => line !== undefined);

  const telegram = await sendTelegramText(lines.join("\n"));
  console.log(
    JSON.stringify(
      {
        live,
        telegram,
        testTrade: {
          id: testTrade.id,
          side: testTrade.side,
          sizeMultiplier: testTrade.sizeMultiplier,
          slUnits: testTrade.slUnits,
          symbol: testTrade.symbol,
          tpUnits: testTrade.tpUnits
        },
        result
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
