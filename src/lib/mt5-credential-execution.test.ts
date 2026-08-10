import assert from "node:assert/strict";
import test from "node:test";

import type { AutoTradeConnection } from "@/lib/auto-trade-connections";
import { executeMt5CredentialAutoTrade } from "@/lib/bridge-auto-trader";
import type { TradeAlert } from "@/lib/types";

function trade(): TradeAlert {
  return {
    createdAt: "2026-08-10T18:00:00.000Z",
    entryMode: "test",
    entryPrice: 1.16,
    entryType: "market",
    estimatedWinRatePct: 55,
    id: "credential-execution-test",
    liveProfitFactor: 2.4,
    market: "forex",
    side: "long",
    signalTime: "2026-08-10T18:00:00.000Z",
    sizeMultiplier: 10,
    slUnits: 10,
    status: "alerted",
    stopLossPrice: 1.159,
    strategy: "Credential execution test",
    symbol: "EURUSD",
    takeProfitPrice: 1.162,
    telegramStatus: "skipped",
    tpUnits: 20,
    unitLabel: "pips"
  };
}

function connection(): AutoTradeConnection {
  return {
    accountId: "12345678",
    accountName: "Korra",
    connectedAt: "2026-08-10T18:00:00.000Z",
    fields: {
      bridgeSecret: "bridge-test-secret",
      bridgeUrl: "https://bridge.example.com/place-order",
      executionMode: "credential_bridge",
      login: "12345678",
      password: "master-password",
      server: "Broker-Demo"
    },
    id: "mt5-test-connection",
    paused: false,
    providerId: "mt5_ea",
    providerLabel: "MetaTrader 5",
    status: "connected",
    updatedAt: "2026-08-10T18:00:00.000Z"
  };
}

test("credential execution authenticates the bridge and records its final reduced lot size", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = process.env.MT5_AUTO_TRADE_ENABLED;
  let request: RequestInit | undefined;
  try {
    process.env.MT5_AUTO_TRADE_ENABLED = "true";
    globalThis.fetch = async (_input, init) => {
      request = init;
      return new Response(
        JSON.stringify({
          accountId: 12345678,
          accountName: "Korra",
          contractId: "EURUSD.a",
          contractName: "EURUSD.a",
          filledPrice: 1.16002,
          orderId: 987654,
          requestedSize: 1,
          size: 0.42,
          sizeReduced: true,
          status: "placed"
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    };

    const result = await executeMt5CredentialAutoTrade(trade(), connection());
    const headers = new Headers(request?.headers);
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;

    assert.equal(headers.get("authorization"), "Bearer bridge-test-secret");
    assert.equal(body.login, "12345678");
    assert.equal(body.password, "master-password");
    assert.equal(body.server, "Broker-Demo");
    assert.equal(body.secret, undefined);
    assert.equal(body.tradeId, "credential-execution-test");
    assert.equal(result.status, "placed");
    assert.equal(result.orders?.[0]?.size, 0.42);
    assert.equal(result.orders?.[0]?.sizeUnit, "lots");
    assert.equal(result.orders?.[0]?.filledPrice, 1.16002);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnabled === undefined) delete process.env.MT5_AUTO_TRADE_ENABLED;
    else process.env.MT5_AUTO_TRADE_ENABLED = originalEnabled;
  }
});
