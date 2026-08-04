import { NextResponse, type NextRequest } from "next/server";

import { num, readJsonBody, requireEaAuth, str } from "@/lib/ea-http";
import { getPendingOrderById, recordOrderResult } from "@/lib/mt5-ea-queue";
import { reflectMt5ResultOnAlert } from "@/lib/mt5-ea-reflect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ orderId: string }> | { orderId: string } };

// POST /ea/orders/result/:orderId — EA reports fill/reject (idempotent).
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireEaAuth(request);
  if (!auth.ok) return auth.response;

  const { orderId } = await Promise.resolve(context.params);
  const body = await readJsonBody(request);

  try {
    const recorded = await recordOrderResult(orderId, {
      status: str(body.status),
      brokerTicket: num(body.brokerTicket),
      fillPrice: num(body.fillPrice),
      slippagePips: num(body.slippagePips),
      commission: num(body.commission),
      swap: num(body.swap),
      spreadPipsAtFire: num(body.spreadPipsAtFire),
      latencyMs: num(body.latencyMs),
      retcode: num(body.retcode),
      retcodeLabel: str(body.retcodeLabel),
      errorMessage: str(body.errorMessage)
    });

    // Mirror the outcome onto the source alert (best-effort; queue row is the
    // authoritative record). Only on a state transition, not a replayed result.
    if (!recorded.skipped && recorded.status) {
      try {
        const row = await getPendingOrderById(orderId);
        if (row) {
          await reflectMt5ResultOnAlert(row, {
            status: recorded.status,
            brokerTicket: num(body.brokerTicket),
            errorMessage: str(body.errorMessage)
          });
        }
      } catch (reflectError) {
        console.error(`[EA-result] alert reflection failed for ${orderId}:`, reflectError instanceof Error ? reflectError.message : reflectError);
      }
    }

    return NextResponse.json({ ok: true, recorded });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
