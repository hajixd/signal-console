import assert from "node:assert/strict";
import test from "node:test";

import { mt5BridgeAccountId, mt5HeartbeatMismatch } from "./mt5-ea-account";

const heartbeat = {
  bridgeAccountId: "12345678",
  terminalConnected: true,
  tradeAllowed: true,
  accountLogin: 12345678,
  accountServer: "FTMO-Demo"
};

test("saved MT5 login becomes the EA connection ID", () => {
  assert.equal(mt5BridgeAccountId({ login: " 12345678 ", server: "FTMO-Demo" }, "fallback"), "12345678");
  assert.equal(mt5BridgeAccountId({}, "fallback"), "fallback");
});

test("MT5 heartbeat must match the saved login and server", () => {
  assert.equal(mt5HeartbeatMismatch({ login: "12345678", server: "ftmo-demo" }, heartbeat), null);
  assert.match(
    mt5HeartbeatMismatch({ login: "999", server: "FTMO-Demo" }, heartbeat) ?? "",
    /reports login 12345678, not 999/
  );
  assert.match(
    mt5HeartbeatMismatch({ login: "12345678", server: "Other-Server" }, heartbeat) ?? "",
    /reports server FTMO-Demo, not Other-Server/
  );
});

test("MT5 heartbeat guards offline terminals and disabled algo trading", () => {
  assert.match(mt5HeartbeatMismatch({ login: "12345678" }, null) ?? "", /No MT5 heartbeat/);
  assert.match(mt5HeartbeatMismatch({ login: "12345678" }, { ...heartbeat, terminalConnected: false }) ?? "", /not connected/);
  assert.match(mt5HeartbeatMismatch({ login: "12345678" }, { ...heartbeat, tradeAllowed: false }) ?? "", /Algo trading is disabled/);
});
