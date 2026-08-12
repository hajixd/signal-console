import assert from "node:assert/strict";
import test from "node:test";
import { autoTradeConnectionRecordId } from "./auto-trade-connections";
import {
  availableMt5ConnectionMode,
  fieldsForMt5ConnectionMode,
  storedMt5ConnectionMode
} from "./mt5-connection-mode";

const MANAGED_ENV = ["EA_INGEST_TOKEN", "MT5_BRIDGE_SECRET", "MT5_BRIDGE_URL", "TURSO_AUTH_TOKEN", "TURSO_DATABASE_URL"] as const;

async function withEnv(values: Partial<Record<(typeof MANAGED_ENV)[number], string | undefined>>, run: () => void | Promise<void>) {
  const before = Object.fromEntries(MANAGED_ENV.map((key) => [key, process.env[key]]));
  try {
    for (const key of MANAGED_ENV) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const key of MANAGED_ENV) {
      const value = before[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("MT5 account linking falls back to the configured terminal EA", async () => {
  await withEnv(
    {
      EA_INGEST_TOKEN: "ea-token",
      TURSO_AUTH_TOKEN: "turso-token",
      TURSO_DATABASE_URL: "libsql://example.turso.io"
    },
    () => {
      assert.equal(availableMt5ConnectionMode(), "terminal_ea");
      assert.deepEqual(
        fieldsForMt5ConnectionMode(
          { bridgeAccountId: "1600170125", login: "1600170125", password: "not-stored", server: "OANDA-Demo-1" },
          "terminal_ea"
        ),
        {
          bridgeAccountId: "1600170125",
          executionMode: "terminal_ea",
          login: "1600170125",
          server: "OANDA-Demo-1"
        }
      );
    }
  );
});

test("terminal EA is the only MT5 mode even when legacy bridge env is present", async () => {
  await withEnv(
    {
      EA_INGEST_TOKEN: "ea-token",
      MT5_BRIDGE_SECRET: "bridge-secret",
      MT5_BRIDGE_URL: "https://bridge.example.com/place-order",
      TURSO_AUTH_TOKEN: "turso-token",
      TURSO_DATABASE_URL: "libsql://example.turso.io"
    },
    () => {
      assert.equal(availableMt5ConnectionMode(), "terminal_ea");
      // terminal_ea mode strips stored passwords — credentials never persist.
      assert.equal(fieldsForMt5ConnectionMode({ password: "encrypted-later" }, "terminal_ea").password, undefined);
    }
  );
});

test("stored MT5 mode resolves to terminal EA for every legacy connection shape", () => {
  assert.equal(storedMt5ConnectionMode({ password: "legacy" }), "terminal_ea");
  assert.equal(storedMt5ConnectionMode({ login: "1600170125" }), "terminal_ea");
  assert.equal(storedMt5ConnectionMode({ executionMode: "terminal_ea", password: "ignored" }), "terminal_ea");
});

test("each MT5 login receives its own stable saved connection record", () => {
  assert.equal(autoTradeConnectionRecordId("mt5_ea", "1600170125"), "mt5_ea_1600170125");
  assert.equal(autoTradeConnectionRecordId("mt5_ea", "24009991"), "mt5_ea_24009991");
  assert.notEqual(autoTradeConnectionRecordId("mt5_ea", "1600170125"), autoTradeConnectionRecordId("mt5_ea", "24009991"));
  assert.equal(
    autoTradeConnectionRecordId("mt5_ea", "1600170125", "Broker-Demo"),
    autoTradeConnectionRecordId("mt5_ea", "1600170125", "broker-demo")
  );
  assert.notEqual(
    autoTradeConnectionRecordId("mt5_ea", "1600170125", "Broker-Demo"),
    autoTradeConnectionRecordId("mt5_ea", "1600170125", "OtherBroker-Demo")
  );
  assert.equal(autoTradeConnectionRecordId("matchtrader", "ignored"), "matchtrader");
});
