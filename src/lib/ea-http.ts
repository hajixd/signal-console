import { NextResponse, type NextRequest } from "next/server";

import { eaIngestAuthorized, eaIngestToken } from "@/lib/mt5-ea-queue";

/** Shared helpers for /ea/* routes (bearer auth + JSON body parsing). */

export type EaAuthResult = { ok: true } | { ok: false; response: NextResponse };

export function requireEaAuth(request: NextRequest): EaAuthResult {
  if (!eaIngestToken()) {
    return { ok: false, response: NextResponse.json({ error: "EA ingest is not configured (EA_INGEST_TOKEN unset)." }, { status: 503 }) };
  }
  if (!eaIngestAuthorized(request.headers.get("authorization"))) {
    return { ok: false, response: NextResponse.json({ error: "missing or invalid bearer token" }, { status: 401 }) };
  }
  return { ok: true };
}

export async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
