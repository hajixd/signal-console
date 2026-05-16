import { NextRequest } from "next/server";
import { handleResearchCron } from "@/lib/research-cron-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return handleResearchCron(request, "backtest");
}

export async function POST(request: NextRequest) {
  return GET(request);
}
