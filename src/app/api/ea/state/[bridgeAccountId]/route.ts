import { NextResponse, type NextRequest } from "next/server";

import { num, readJsonBody, requireEaAuth, str } from "@/lib/ea-http";
import { pushAccountState } from "@/lib/mt5-ea-queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ bridgeAccountId: string }> | { bridgeAccountId: string } };

// POST /ea/state/:bridgeAccountId — EA pushes balance/equity snapshot.
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireEaAuth(request);
  if (!auth.ok) return auth.response;

  const { bridgeAccountId } = await Promise.resolve(context.params);
  const body = await readJsonBody(request);

  try {
    await pushAccountState(bridgeAccountId, {
      bridgeStatus: str(body.bridgeStatus),
      balance: num(body.balance),
      equity: num(body.equity),
      margin: num(body.margin),
      freeMargin: num(body.freeMargin),
      marginLevelPct: num(body.marginLevelPct),
      floatingPnL: num(body.floatingPnL),
      openPositionCount: num(body.openPositionCount),
      lastError: str(body.lastError)
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
