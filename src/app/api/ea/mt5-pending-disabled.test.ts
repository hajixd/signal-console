import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/ea/orders/pending/[bridgeAccountId]/route";

test("disabled Forex execution never releases queued MT5 orders", async () => {
  const originalToken = process.env.EA_INGEST_TOKEN;
  process.env.EA_INGEST_TOKEN = "test-ea-token";

  try {
    const request = new NextRequest("https://korra.space/ea/orders/pending/test-account", {
      headers: { authorization: "Bearer test-ea-token" }
    });
    const response = await GET(request, { params: { bridgeAccountId: "test-account" } });
    const body = (await response.json()) as { disabled?: boolean; orders?: unknown[] };

    assert.equal(response.status, 200);
    assert.equal(body.disabled, true);
    assert.deepEqual(body.orders, []);
  } finally {
    if (originalToken === undefined) delete process.env.EA_INGEST_TOKEN;
    else process.env.EA_INGEST_TOKEN = originalToken;
  }
});
