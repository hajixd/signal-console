import type { Mt5Heartbeat } from "@/lib/mt5-ea-state";

export const DEFAULT_MT5_BRIDGE_ACCOUNT_ID = "mt5-demo-100k";

function clean(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function mt5BridgeAccountId(
  fields: Record<string, string> | null | undefined,
  environmentId = process.env.MT5_EA_DEMO_ACCOUNT_ID
): string {
  return clean(fields?.bridgeAccountId) || clean(fields?.login) || clean(environmentId) || DEFAULT_MT5_BRIDGE_ACCOUNT_ID;
}

export function mt5HeartbeatMismatch(
  fields: Record<string, string> | null | undefined,
  heartbeat: Mt5Heartbeat | null
): string | null {
  const expectedLogin = clean(fields?.login);
  const expectedServer = clean(fields?.server);
  if (!expectedLogin && !expectedServer) return null;
  if (!heartbeat) return `No MT5 heartbeat was found for connection ID ${mt5BridgeAccountId(fields)}.`;

  if (expectedLogin && String(heartbeat.accountLogin ?? "") !== expectedLogin) {
    return `The connected MT5 terminal reports login ${heartbeat.accountLogin ?? "unknown"}, not ${expectedLogin}.`;
  }

  if (expectedServer && (heartbeat.accountServer ?? "").trim().toLowerCase() !== expectedServer.toLowerCase()) {
    return `The connected MT5 terminal reports server ${heartbeat.accountServer || "unknown"}, not ${expectedServer}.`;
  }

  if (!heartbeat.terminalConnected) return "The MT5 terminal is not connected to its broker.";
  if (!heartbeat.tradeAllowed) return "Algo trading is disabled in the connected MT5 terminal.";
  return null;
}
