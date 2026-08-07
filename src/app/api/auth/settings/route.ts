import { NextRequest, NextResponse } from "next/server";
import { updateAppPassword, updateAppTheme, updateAppUsername } from "@/lib/app-auth";
import { appUserFromRequest } from "@/lib/app-session";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  const user = await appUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Log in to update settings." }, { status: 401 });
  const payload = ((await request.json().catch(() => ({}))) ?? {}) as {
    currentPassword?: unknown;
    newPassword?: unknown;
    theme?: unknown;
    username?: unknown;
  };
  try {
    let updated = user;
    if (payload.username !== undefined) updated = await updateAppUsername(user.id, payload.username);
    if (payload.newPassword !== undefined) await updateAppPassword(user.id, payload.currentPassword, payload.newPassword);
    if (payload.theme !== undefined) updated = await updateAppTheme(user.id, payload.theme);
    return NextResponse.json({ user: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Settings update failed." }, { status: 400 });
  }
}
