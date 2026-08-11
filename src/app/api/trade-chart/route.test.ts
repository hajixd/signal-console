import assert from "node:assert/strict";
import test from "node:test";
import { assetForSymbol } from "@/lib/assets";
import { historicalTwelveDataChartSymbol } from "./route";

function requiredAsset(symbol: string) {
  const asset = assetForSymbol(symbol);
  assert.ok(asset, `Expected ${symbol} in the asset catalog`);
  return asset;
}

test("historical chart fallback maps expired micro crypto futures to their underlying pair", () => {
  assert.equal(historicalTwelveDataChartSymbol(requiredAsset("MBT")), "BTC/USD");
  assert.equal(historicalTwelveDataChartSymbol(requiredAsset("MET")), "ETH/USD");
});

test("historical chart fallback keeps configured forex symbols and avoids unrelated futures proxies", () => {
  assert.equal(historicalTwelveDataChartSymbol(requiredAsset("EURUSD")), "EUR/USD");
  assert.equal(historicalTwelveDataChartSymbol(requiredAsset("HG")), null);
});
