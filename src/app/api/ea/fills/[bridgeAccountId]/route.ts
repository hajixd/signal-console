import { NextResponse, type NextRequest } from "next/server";

import { num, readJsonBody, requireEaAuth } from "@/lib/ea-http";
import { recordFillEvent } from "@/lib/mt5-ea-queue";
import { reflectMt5CloseOnAlert } from "@/lib/mt5-ea-reflect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ bridgeAccountId: string }> | { bridgeAccountId: string } };

// POST /ea/fills/:bridgeAccountId — event-driven fills (SL/TP hit, manual close).
// Reconciles realized close P&L onto the opening order, then mirrors it onto the
// source alert. Opening deals are ignored by recordFillEvent.
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireEaAuth(request);
  if (!auth.ok) return auth.response;

  const { bridgeAccountId } = await Promise.resolve(context.params);
  const body = await readJsonBody(request);

  try {
    const reconciled = await recordFillEvent(bridgeAccountId, {
      ticket: num(body.ticket),
      dealType: num(body.dealType),
      symbol: typeof body.symbol === "string" ? body.symbol : undefined,
      volume: num(body.volume),
      price: num(body.price),
      profit: num(body.profit),
      commission: num(body.commission),
      swap: num(body.swap),
      reason: num(body.reason),
      positionTicket: num(body.positionTicket)
    });

    if (reconciled.matched && typeof reconciled.closeProfit === "number") {
      try {
        await reflectMt5CloseOnAlert({
          sourceAlertId: reconciled.sourceAlertId,
          customTag: reconciled.customTag,
          netPnlDollars: reconciled.closeProfit
        });
      } catch (reflectError) {
        console.error(`[EA-fills] close reflection failed:`, reflectError instanceof Error ? reflectError.message : reflectError);
      }
    }

    return NextResponse.json({ ok: true, reconciled });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
