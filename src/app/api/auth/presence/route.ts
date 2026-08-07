import { NextRequest, NextResponse } from "next/server";
import { listOnlineAppUsers, updateAppPresence } from "@/lib/app-auth";
import { appUserFromRequest } from "@/lib/app-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await appUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Log in to view presence." }, { status: 401 });
  return NextResponse.json({ online: await listOnlineAppUsers() });
}

export async function POST(request: NextRequest) {
  const user = await appUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Log in to update presence." }, { status: 401 });
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as { area?: unknown };
  await updateAppPresence(user, payload.area);
  return NextResponse.json({ ok: true });
}
