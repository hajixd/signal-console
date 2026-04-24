import { NextResponse } from "next/server";
import { activeRules } from "@/lib/signal-strategies";
import { getTrades, storageMode } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const trades = await getTrades();
  const rules = await activeRules();
  return NextResponse.json({
    storage: storageMode(),
    rules,
    trades
  });
}
