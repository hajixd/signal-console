import { mt5CredentialBridgeConfigured } from "@/lib/mt5-credential-bridge";
import { mt5EaConfigured } from "@/lib/mt5-ea-queue";

export type Mt5ConnectionMode = "credential_bridge" | "terminal_ea";

export function availableMt5ConnectionMode(): Mt5ConnectionMode | null {
  if (mt5CredentialBridgeConfigured()) return "credential_bridge";
  if (mt5EaConfigured()) return "terminal_ea";
  return null;
}

export function storedMt5ConnectionMode(fields: Record<string, string> | null | undefined): Mt5ConnectionMode {
  if (fields?.executionMode === "terminal_ea") return "terminal_ea";
  if (fields?.executionMode === "credential_bridge") return "credential_bridge";
  return fields?.password ? "credential_bridge" : "terminal_ea";
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
