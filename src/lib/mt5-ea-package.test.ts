import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const eaPath = path.join(process.cwd(), "public", "mt5", "KorraMT5ExecutionEA.mq5");

test("downloadable MT5 EA uses the signed-in login and the production queue contract", async () => {
  const source = await readFile(eaPath, "utf8");

  assert.match(source, /input string ConnectionId = "";/);
  assert.doesNotMatch(source, /input string SymbolMap/);
  assert.match(source, /AccountInfoInteger\(ACCOUNT_LOGIN\)/);
  assert.match(source, /SymbolsTotal\(false\)/);
  assert.match(source, /SymbolName\(index, false\)/);
  assert.match(source, /\/api\/ea\/heartbeat\//);
  assert.match(source, /\/api\/ea\/state\//);
  assert.match(source, /\/api\/ea\/orders\/pending\//);
  assert.match(source, /\/api\/ea\/orders\/result\//);
  assert.match(source, /\/api\/ea\/fills\//);
});
