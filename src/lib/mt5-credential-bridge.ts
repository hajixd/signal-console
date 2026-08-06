import { fieldText, readJsonResponse, requiredEnv } from "@/lib/auto-trade-utils";

export type Mt5CredentialVerification = {
  accountId: number;
  accountName?: string;
  balance?: number;
  connected: boolean;
  currency?: string;
  equity?: number;
  server: string;
  status: "connected";
  tradeAllowed: boolean;
};

type Mt5CredentialVerificationResponse = Partial<Mt5CredentialVerification> & {
  error?: string;
  status?: "connected" | "failed";
};

export function mt5CredentialBridgeConfigured(): boolean {
  return requiredEnv(["MT5_BRIDGE_URL", "MT5_BRIDGE_SECRET"]).length === 0;
}

export function mt5CredentialBridgeEndpoint(bridgeUrl: string, operation: "place-order" | "verify-account"): string {
  const url = new URL(bridgeUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.at(-1) === "place-order" || segments.at(-1) === "verify-account") segments.pop();
  segments.push(operation);
  url.pathname = `/${segments.join("/")}`;
  return url.toString();
}

export async function verifyMt5CredentialConnection(fields: Record<string, string>): Promise<Mt5CredentialVerification> {
  const bridgeUrl = fieldText(fields, "bridgeUrl", "MT5_BRIDGE_URL");
  const bridgeSecret = fieldText(fields, "bridgeSecret", "MT5_BRIDGE_SECRET");
  if (!bridgeUrl || !bridgeSecret) {
    throw new Error("The secure MT5 connection service is not online yet.");
  }

  const response = await fetch(mt5CredentialBridgeEndpoint(bridgeUrl, "verify-account"), {
    body: JSON.stringify({
      login: fields.login,
      password: fields.password,
      secret: bridgeSecret,
      server: fields.server
    }),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  const parsed = await readJsonResponse<Mt5CredentialVerificationResponse>(response, "MT5 could not verify this account.");
  if (parsed.status !== "connected" || !parsed.connected || parsed.error) {
    throw new Error(parsed.error || "MT5 could not verify this account.");
  }
  if (String(parsed.accountId ?? "") !== fields.login) {
    throw new Error(`MT5 connected to login ${parsed.accountId ?? "unknown"}, not ${fields.login}.`);
  }
  if ((parsed.server ?? "").trim().toLowerCase() !== fields.server.trim().toLowerCase()) {
    throw new Error(`MT5 connected to server ${parsed.server || "unknown"}, not ${fields.server}.`);
  }
  if (!parsed.tradeAllowed) {
    throw new Error("This MT5 login is read-only or trading is disabled. Use the master trading password.");
  }
  return parsed as Mt5CredentialVerification;
}
