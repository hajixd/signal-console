import assert from "node:assert/strict";
import test from "node:test";
import type { AutoTradeConnection } from "./auto-trade-connections";
import { aggregateMt5Results } from "./mt5-ea-auto-trader";

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
