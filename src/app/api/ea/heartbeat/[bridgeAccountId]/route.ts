import { NextResponse, type NextRequest } from "next/server";

import { bool, num, readJsonBody, requireEaAuth, str } from "@/lib/ea-http";
import { upsertHeartbeat } from "@/lib/mt5-ea-queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ bridgeAccountId: string }> | { bridgeAccountId: string } };

// POST /ea/heartbeat/:bridgeAccountId — EA liveness ping.
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireEaAuth(request);
  if (!auth.ok) return auth.response;

  const { bridgeAccountId } = await Promise.resolve(context.params);
  const body = await readJsonBody(request);

  try {
    await upsertHeartbeat(bridgeAccountId, {
      eaVersion: str(body.eaVersion) ?? str(request.headers.get("x-ea-version") ?? undefined),
      terminalBuild: num(body.terminalBuild),
      terminalConnected: bool(body.terminalConnected),
      tradeAllowed: bool(body.tradeAllowed),
      accountLogin: num(body.accountLogin),
      accountServer: str(body.accountServer),
      lastError: str(body.lastError)
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
