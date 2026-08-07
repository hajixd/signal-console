import { NextRequest, NextResponse } from "next/server";
import { listWorkspaceAppUsers } from "@/lib/app-auth";
import { appUserFromRequest } from "@/lib/app-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await appUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Log in to view workspace accounts." }, { status: 401 });
  const accounts = (await listWorkspaceAppUsers()).map(({ createdAt, id, role, username }) => ({
    createdAt,
    id,
    role,
    username
  }));
  return NextResponse.json({ accounts });
}
