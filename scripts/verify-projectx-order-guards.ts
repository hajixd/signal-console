import { contractSearchTextsForTrade, projectXBracketTicksForTrade } from "../src/lib/projectx-auto-trader";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const swissMonthOnlySearch = contractSearchTextsForTrade({
  assetKey: "swiss_franc_futures",
  symbol: "M7"
});
assert(swissMonthOnlySearch.includes("6S"), `Expected Swiss Franc asset fallback to include 6S, got ${swissMonthOnlySearch.join(", ")}`);
assert(swissMonthOnlySearch[0] !== "M7", `Expected M7 not to be the first/only Swiss Franc ProjectX lookup, got ${swissMonthOnlySearch.join(", ")}`);

const swissContractSearch = contractSearchTextsForTrade({ symbol: "6SM6" });
assert(swissContractSearch.includes("6S"), `Expected 6SM6 contract lookup to include root 6S, got ${swissContractSearch.join(", ")}`);

const shortTicks = projectXBracketTicksForTrade({
  entryPrice: 1.2754,
  side: "short",
  slUnits: 8,
  stopLossPrice: 1.2762,
  takeProfitPrice: 1.2746,
  tpUnits: 8
});
assert(shortTicks.takeProfitTicks === -8, `Expected short take-profit ticks to be -8, got ${shortTicks.takeProfitTicks}`);
assert(shortTicks.stopLossTicks === 8, `Expected short stop-loss ticks to be 8, got ${shortTicks.stopLossTicks}`);

const longTicks = projectXBracketTicksForTrade({
  entryPrice: 6000,
  side: "long",
  slUnits: 10,
  stopLossPrice: 5997.5,
  takeProfitPrice: 6005,
  tpUnits: 20
});
assert(longTicks.takeProfitTicks === 20, `Expected long take-profit ticks to be 20, got ${longTicks.takeProfitTicks}`);
assert(longTicks.stopLossTicks === -10, `Expected long stop-loss ticks to be -10, got ${longTicks.stopLossTicks}`);

let rejectedInvalidGeometry = false;
try {
  projectXBracketTicksForTrade({
    entryPrice: 1.2754,
    side: "short",
    slUnits: 8,
    stopLossPrice: 1.2762,
    takeProfitPrice: 1.276,
    tpUnits: 8
  });
} catch {
  rejectedInvalidGeometry = true;
}
assert(rejectedInvalidGeometry, "Expected invalid short TP/SL geometry to be rejected before ProjectX order placement.");

console.log("ProjectX order guards verified.");
