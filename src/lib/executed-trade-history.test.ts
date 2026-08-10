import assert from "node:assert/strict";
import test from "node:test";
import { onlyExecutedTradeHistoryRows } from "@/lib/executed-trade-history";

test("account history exposes only completed filled trades", () => {
  const rows = onlyExecutedTradeHistoryRows([
    { id: "filled-win", profitAndLoss: 929, statusClass: "closed" },
    { id: "filled-loss", profitAndLoss: -150, statusClass: "closed" },
    { id: "cancelled", statusClass: "warn" },
    { id: "rejected", statusClass: "failed" },
    { id: "voided", statusClass: "voided" }
  ]);

  assert.deepEqual(rows.map((row) => row.id), ["filled-win", "filled-loss"]);
});

test("a filled breakeven trade remains visible", () => {
  const rows = onlyExecutedTradeHistoryRows([{ id: "flat", profitAndLoss: 0, statusClass: "closed" }]);

  assert.equal(rows.length, 1);
});
