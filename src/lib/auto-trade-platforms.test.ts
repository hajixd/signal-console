import assert from "node:assert/strict";
import test from "node:test";

import {
  autoTradeProviderFullyFunctioning,
  autoTradeProvidersForMarket,
  FULLY_FUNCTIONING_AUTO_TRADE_PROVIDER_IDS
} from "./auto-trade-platforms";

test("ProjectX and the MT5 EA are available production execution paths", () => {
  assert.deepEqual([...FULLY_FUNCTIONING_AUTO_TRADE_PROVIDER_IDS], ["projectx", "mt5_ea"]);
  assert.equal(autoTradeProviderFullyFunctioning("projectx"), true);
  assert.equal(autoTradeProviderFullyFunctioning("mt5_ea"), true);
});

test("MT5 EA is the fully functioning forex provider", () => {
  const provider = autoTradeProvidersForMarket("forex").find((option) => autoTradeProviderFullyFunctioning(option.id));
  assert.equal(provider?.id, "mt5_ea");
  assert.equal(provider?.status, "live");
});
