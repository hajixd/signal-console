import assert from "node:assert/strict";
import test from "node:test";
import type { AutoTradeConnection } from "./auto-trade-connections";
import { aggregateMt5Results, executeMt5TradesForConnections } from "./mt5-ea-auto-trader";
import type { TradeAlert } from "./types";

function connection(id: string, name: string, login: string): AutoTradeConnection {
  return {
    accountId: login,
    accountName: name,
    connectedAt: new Date(0).toISOString(),
    fields: { bridgeAccountId: login, executionMode: "terminal_ea", login, server: "Broker-Demo" },
    id,
    paused: false,
    providerId: "mt5_ea",
    providerLabel: "MetaTrader 5",
    status: "connected",
    updatedAt: new Date(0).toISOString()
  };
}

function credentialConnection(id: string, name: string, login: string, server: string): AutoTradeConnection {
  return {
    ...connection(id, name, login),
    fields: {
      executionMode: "credential_bridge",
      login,
      password: `${login}-master-password`,
      server
    }
  };
}

function forexTrade(): TradeAlert {
  return {
    createdAt: "2026-08-10T18:00:00.000Z",
    entryMode: "test",
    entryPrice: 1.16,
    entryType: "market",
    estimatedWinRatePct: 55,
    id: "multi-account-credential-test",
    liveProfitFactor: 2.4,
    market: "forex",
    side: "long",
    signalTime: "2026-08-10T18:00:00.000Z",
    sizeMultiplier: 1,
    slUnits: 10,
    status: "alerted",
    stopLossPrice: 1.159,
    strategy: "Multi-account credential test",
    symbol: "EURUSD",
    takeProfitPrice: 1.162,
    telegramStatus: "skipped",
    tpUnits: 20,
    unitLabel: "pips"
  };
}

test("MT5 fanout keeps successful accounts live when another account is skipped", () => {
  const first = connection("mt5_ea_10001", "Korra", "10001");
  const second = connection("mt5_ea_10002", "Itachi", "10002");
  const aggregate = aggregateMt5Results([
    {
      connection: first,
      execution: {
        checkedAt: new Date().toISOString(),
        orders: [{ accountId: 10001, accountName: "Korra", status: "placed" }],
        status: "placed"
      }
    },
    {
      connection: second,
      execution: {
        checkedAt: new Date().toISOString(),
        error: "The connected MT5 account is paused.",
        orders: [{ accountId: 10002, accountName: "Itachi", status: "skipped" }],
        status: "skipped"
      }
    }
  ]);

  assert.equal(aggregate.status, "placed");
  assert.equal(aggregate.orders?.length, 2);
  assert.match(aggregate.error ?? "", /Itachi: .*paused/);
});

test("MT5 credential fanout sends one isolated order to every active account", async () => {
  const originalFetch = globalThis.fetch;
  const originalBridgeUrl = process.env.MT5_BRIDGE_URL;
  const originalBridgeSecret = process.env.MT5_BRIDGE_SECRET;
  const originalEnabled = process.env.MT5_AUTO_TRADE_ENABLED;
  const requests: Array<Record<string, unknown>> = [];
  try {
    process.env.MT5_BRIDGE_URL = "https://bridge.example.com";
    process.env.MT5_BRIDGE_SECRET = "bridge-secret";
    process.env.MT5_AUTO_TRADE_ENABLED = "true";
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return new Response(JSON.stringify({
        accountId: Number(body.login),
        accountName: `Account ${body.login}`,
        contractId: "EURUSD",
        contractName: "EURUSD",
        orderId: Number(body.login),
        size: body.size,
        status: "placed"
      }), { headers: { "content-type": "application/json" }, status: 200 });
    };

    const result = await executeMt5TradesForConnections(forexTrade(), [
      credentialConnection("mt5_ea_first", "Korra", "11111111", "First-Broker"),
      credentialConnection("mt5_ea_second", "Itachi", "22222222", "Second-Broker")
    ]);

    assert.equal(result.status, "placed");
    assert.equal(result.orders?.length, 2);
    assert.deepEqual(requests.map((request) => request.login), ["11111111", "22222222"]);
    assert.deepEqual(requests.map((request) => request.server), ["First-Broker", "Second-Broker"]);
    assert.deepEqual(requests.map((request) => request.password), ["11111111-master-password", "22222222-master-password"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBridgeUrl === undefined) delete process.env.MT5_BRIDGE_URL;
    else process.env.MT5_BRIDGE_URL = originalBridgeUrl;
    if (originalBridgeSecret === undefined) delete process.env.MT5_BRIDGE_SECRET;
    else process.env.MT5_BRIDGE_SECRET = originalBridgeSecret;
    if (originalEnabled === undefined) delete process.env.MT5_AUTO_TRADE_ENABLED;
    else process.env.MT5_AUTO_TRADE_ENABLED = originalEnabled;
  }
});
