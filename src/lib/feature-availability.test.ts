import assert from "node:assert/strict";
import test from "node:test";

import { executeAutoTrade, executeAutoTradeTest } from "@/lib/auto-trader";
import { sendDiscord } from "@/lib/discord";
import { FEATURE_AVAILABILITY, marketFeatureEnabled } from "@/lib/feature-availability";
import { sendTelegram } from "@/lib/telegram";
import type { TradeAlert } from "@/lib/types";

function forexTrade(): TradeAlert {
  return {
    createdAt: "2026-08-19T12:00:00.000Z",
    entryMode: "test",
    entryPrice: 1.1,
    estimatedWinRatePct: 55,
    id: "disabled-forex-signal",
    liveProfitFactor: 2,
    market: "forex",
    side: "long",
    signalTime: "2026-08-19T12:00:00.000Z",
    slUnits: 10,
    status: "alerted",
    stopLossPrice: 1.099,
    strategy: "Disabled forex test",
    symbol: "EURUSD",
    takeProfitPrice: 1.102,
    telegramStatus: "skipped",
    tpUnits: 20,
    unitLabel: "pips"
  };
}

test("temporarily disabled product surfaces stay off", () => {
  assert.equal(FEATURE_AVAILABILITY.forex, false);
  assert.equal(FEATURE_AVAILABILITY.productTour, false);
  assert.equal(FEATURE_AVAILABILITY.research, false);
});

test("forex aliases are blocked while futures remain enabled", () => {
  assert.equal(marketFeatureEnabled("forex"), false);
  assert.equal(marketFeatureEnabled("gold_spot"), false);
  assert.equal(marketFeatureEnabled("futures"), true);
});

test("forex broker routing and provider tests stop before execution", async () => {
  const signalResult = await executeAutoTrade(forexTrade());
  const providerTestResult = await executeAutoTradeTest({ providerId: "mt5_ea" });

  assert.equal(signalResult.status, "disabled");
  assert.match(signalResult.error ?? "", /temporarily disabled/i);
  assert.equal(providerTestResult.status, "disabled");
  assert.match(providerTestResult.error ?? "", /temporarily disabled/i);
});

test("forex notification channels stop before making network requests", async () => {
  const originalFetch = globalThis.fetch;
  const originalTelegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalTelegramChatId = process.env.TELEGRAM_CHAT_ID;
  const originalDiscordWebhook = process.env.DISCORD_WEBHOOK_URL;
  let fetchCalls = 0;

  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  process.env.DISCORD_WEBHOOK_URL = "https://example.invalid/webhook";
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Disabled Forex notification reached the network.");
  }) as typeof fetch;

  try {
    const [telegram, discord] = await Promise.all([sendTelegram(forexTrade()), sendDiscord(forexTrade())]);
    assert.equal(telegram.status, "skipped");
    assert.equal(discord.status, "skipped");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTelegramToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalTelegramToken;
    if (originalTelegramChatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = originalTelegramChatId;
    if (originalDiscordWebhook === undefined) delete process.env.DISCORD_WEBHOOK_URL;
    else process.env.DISCORD_WEBHOOK_URL = originalDiscordWebhook;
  }
});
