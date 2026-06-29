import { NextResponse, type NextRequest } from "next/server";

import { requireEaAuth } from "@/lib/ea-http";
import { claimPendingOrders } from "@/lib/mt5-ea-queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ bridgeAccountId: string }> | { bridgeAccountId: string } };

// GET /ea/orders/pending/:bridgeAccountId — EA claims queued orders.
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = requireEaAuth(request);
  if (!auth.ok) return auth.response;

  const { bridgeAccountId } = await Promise.resolve(context.params);
  const includeStaleClaimed = request.nextUrl.searchParams.get("includeStaleClaimed") === "true";

  try {
    const orders = await claimPendingOrders(bridgeAccountId, includeStaleClaimed);
    return NextResponse.json({ orders });
  } catch (error) {
    // Lenient: the EA polls on a tight loop; a 500 just retries next tick.
    return NextResponse.json(
      { orders: [], error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
