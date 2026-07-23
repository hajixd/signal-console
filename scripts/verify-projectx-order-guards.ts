import {
  contractSearchTextsForTrade,
  projectXBracketTicksForTrade,
  projectXMarketEntryRequest,
  projectXSizeAttemptSequence,
  projectXSizeErrorAllowsRetry
} from "../src/lib/projectx-auto-trader";

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

const minimumLongTicks = projectXBracketTicksForTrade({
  entryPrice: 100,
  side: "long",
  slUnits: 4,
  stopLossPrice: 99,
  takeProfitPrice: 101,
  tpUnits: 4
});
assert(minimumLongTicks.stopLossTicks === -6, `Expected minimum long stop-loss ticks to be -6, got ${minimumLongTicks.stopLossTicks}`);
assert(minimumLongTicks.takeProfitTicks === 6, `Expected minimum long take-profit ticks to be 6, got ${minimumLongTicks.takeProfitTicks}`);

const marketRequest = projectXMarketEntryRequest({
  accountId: 123,
  contractId: "CON.F.US.MES.M26",
  customTag: "test",
  side: 0,
  size: 1,
  stopLossTicks: minimumLongTicks.stopLossTicks,
  takeProfitTicks: minimumLongTicks.takeProfitTicks
});
assert(marketRequest.type === 2, `Expected ProjectX entry type 2 (market), got ${marketRequest.type}`);
assert(marketRequest.limitPrice === null, `Expected no ProjectX entry limit price, got ${marketRequest.limitPrice}`);

assert(
  JSON.stringify(projectXSizeAttemptSequence(5)) === JSON.stringify([5, 4, 3, 2, 1]),
  `Expected descending ProjectX size attempts for 5, got ${projectXSizeAttemptSequence(5).join(", ")}`
);
assert(
  JSON.stringify(projectXSizeAttemptSequence(15)) === JSON.stringify([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  `Expected one-unit ProjectX reductions through the standard 15-mini cap, got ${projectXSizeAttemptSequence(15).join(", ")}`
);
const largeSizeAttempts = projectXSizeAttemptSequence(50);
assert(largeSizeAttempts[0] === 50, `Expected large-size retry sequence to start at 50, got ${largeSizeAttempts[0]}`);
assert(largeSizeAttempts.at(-1) === 1, `Expected large-size retry sequence to end at 1, got ${largeSizeAttempts.at(-1)}`);
assert(largeSizeAttempts.length <= 20, `Expected efficient bounded retries, got ${largeSizeAttempts.length}`);
assert(projectXSizeErrorAllowsRetry("ProjectX order rejected", 3), "Expected ProjectX insufficient-funds error code 3 to retry smaller.");
assert(projectXSizeErrorAllowsRetry("Insufficient margin"), "Expected margin rejection text to retry smaller.");
assert(projectXSizeErrorAllowsRetry("Risk check failed"), "Expected generic broker risk rejection to retry smaller.");
assert(projectXSizeErrorAllowsRetry("Position limit exceeded"), "Expected position-limit rejection to retry smaller.");
assert(!projectXSizeErrorAllowsRetry("Market is closed", 5), "Expected outside-trading-hours rejection not to retry smaller.");
assert(!projectXSizeErrorAllowsRetry("Daily trade limit reached", 3), "Expected daily trade-limit lockout not to retry smaller.");
assert(!projectXSizeErrorAllowsRetry("Symbol is blocked", 3), "Expected symbol block not to retry smaller.");
assert(!projectXSizeErrorAllowsRetry("Too many requests (429)", 3), "Expected rate limiting not to trigger smaller orders.");
assert(!projectXSizeErrorAllowsRetry("Invalid bracket price", 3), "Expected invalid bracket geometry not to trigger smaller orders.");

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
