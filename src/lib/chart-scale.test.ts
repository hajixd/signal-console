import assert from "node:assert/strict";
import test from "node:test";
import { focusedPriceDomain, priceAxisFractionDigits } from "@/lib/chart-scale";

test("small-priced forex charts use proportional rather than fixed padding", () => {
  const domain = focusedPriceDomain([0.00631, 0.006322, 0.00633], 0.00631);

  assert.ok(domain.min > 0.0063);
  assert.ok(domain.max < 0.00634);
  assert.ok(domain.min < 0.00631);
  assert.ok(domain.max > 0.00633);
});

test("each chart preserves all of its own relevant levels", () => {
  const domain = focusedPriceDomain([457.25, 458.5, 459.75, 460], 458.5);

  assert.ok(domain.min < 457.25);
  assert.ok(domain.max > 460);
  assert.ok(domain.max - domain.min < 3.5);
});

test("flat charts still receive a small visible range", () => {
  const domain = focusedPriceDomain([100, 100], 100);

  assert.ok(domain.min < 100);
  assert.ok(domain.max > 100);
  assert.ok(domain.max - domain.min < 0.04);
});

test("focused low-priced axes gain enough precision to keep tick labels distinct", () => {
  const domain = focusedPriceDomain([0.00631, 0.006322, 0.00633], 0.00631);

  assert.equal(priceAxisFractionDigits(domain, 0.00631), 6);
});
