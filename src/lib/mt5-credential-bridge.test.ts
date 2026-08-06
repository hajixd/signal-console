import assert from "node:assert/strict";
import test from "node:test";

import { mt5CredentialBridgeEndpoint } from "./mt5-credential-bridge";

test("MT5 credential bridge operations share the configured service root", () => {
  assert.equal(
    mt5CredentialBridgeEndpoint("https://bridge.example.com/place-order", "verify-account"),
    "https://bridge.example.com/verify-account"
  );
  assert.equal(
    mt5CredentialBridgeEndpoint("https://bridge.example.com/mt5/", "place-order"),
    "https://bridge.example.com/mt5/place-order"
  );
});
