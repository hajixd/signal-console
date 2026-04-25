import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-api";
import { sendTelegramText, telegramConfigured } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function defaultMessage(): string {
  return [
    "Signal Console Telegram test",
    `Checked at ${new Date().toISOString()}`,
    "",
    "This is a manual verification message from the protected admin test route."
  ].join("\n");
}

export async function GET(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    configured: telegramConfigured(),
    route: "/api/admin/test-telegram"
  });
}

export async function POST(request: Request) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = ((await request.json().catch(() => ({}))) ?? {}) as { message?: string };
  const message = typeof body.message === "string" && body.message.trim().length > 0 ? body.message.trim() : defaultMessage();
  const result = await sendTelegramText(message);

  return NextResponse.json({
    ok: result.status === "sent" || result.status === "skipped",
    ...result
  });
}
