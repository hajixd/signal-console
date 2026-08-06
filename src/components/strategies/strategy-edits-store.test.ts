import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultStrategyEdit,
  normalizeStrategyEdit,
  type StrategyEditOption
} from "./strategy-edits-store";

const strategy: StrategyEditOption = {
  dollarPerUnit: 10,
  key: "saved-scale-test",
  label: "Saved scale test",
  phase: "test",
  riskDollars: 200,
  sizeLabel: "2 contracts",
  slUnits: 10,
  symbol: "TEST",
  targetDollars: 400,
  tpUnits: 20
};

test("a persisted relative scale is converted to contracts without being reset by defaults", () => {
  const edit = normalizeStrategyEdit(strategy, { scale: 0.1 });

  assert.equal(defaultStrategyEdit(strategy).contracts, 2);
  assert.equal(edit.contracts, 0.2);
  assert.equal(edit.scale, 0.1);
});

test("an explicit contract edit remains authoritative for legacy saved settings", () => {
  const edit = normalizeStrategyEdit(strategy, { contracts: 3, scale: 0.1 });

  assert.equal(edit.contracts, 3);
  assert.equal(edit.scale, 1.5);
});
