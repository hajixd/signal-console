import assert from "node:assert/strict";
import test from "node:test";

import {
  autoTradeProviderFullyFunctioning,
  autoTradeProvidersForMarket,
  FULLY_FUNCTIONING_AUTO_TRADE_PROVIDER_IDS
} from "./auto-trade-platforms";

test("ProjectX and MT5 are available production execution paths", () => {
  assert.deepEqual([...FULLY_FUNCTIONING_AUTO_TRADE_PROVIDER_IDS], ["projectx", "mt5_ea"]);
  assert.equal(autoTradeProviderFullyFunctioning("projectx"), true);
  assert.equal(autoTradeProviderFullyFunctioning("mt5_ea"), true);
});

test("forex exposes one fully functioning MT5 provider without the legacy duplicate", () => {
  const forexProviders = autoTradeProvidersForMarket("forex");
  const mt5Providers = forexProviders.filter((option) => option.shortLabel === "MT5");
  const provider = forexProviders.find((option) => autoTradeProviderFullyFunctioning(option.id));
  assert.equal(mt5Providers.length, 1);
  assert.equal(forexProviders.some((option) => option.id === "mt5_bridge"), false);
  assert.equal(provider?.id, "mt5_ea");
  assert.equal(provider?.shortLabel, "MT5");
  assert.equal(provider?.status, "live");
});
