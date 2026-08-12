import { mt5EaConfigured } from "@/lib/mt5-ea-queue";

// The terminal EA/pull lane is the ONLY MT5 execution mode. The
// credential-bridge mode (users submitting MT5 passwords for a central push
// bridge) was removed with the TradeLocker and mt5_bridge connectors — it was
// never operational and required exposing an inbound HTTP port on the
// execution VM. The type keeps its historical shape so stored connection
// fields written under the old mode still parse.
export type Mt5ConnectionMode = "credential_bridge" | "terminal_ea";

export function availableMt5ConnectionMode(): Mt5ConnectionMode | null {
  return mt5EaConfigured() ? "terminal_ea" : null;
}

export function storedMt5ConnectionMode(_fields: Record<string, string> | null | undefined): Mt5ConnectionMode {
  return "terminal_ea";
}

export function fieldsForMt5ConnectionMode(fields: Record<string, string>, mode: Mt5ConnectionMode): Record<string, string> {
  const nextFields: Record<string, string> = { ...fields, executionMode: mode };
  if (mode === "terminal_ea") {
    delete nextFields.password;
    delete nextFields.bridgeUrl;
    delete nextFields.bridgeSecret;
  }
  return nextFields;
}
