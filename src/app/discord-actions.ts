"use server";

import { discordChannelInviteLink, discordChannelTitle, discordConfigured, sendDiscordText } from "@/lib/discord";
import type { NotificationStatus } from "@/lib/types";

export type TestDiscordAlertResult = {
  error?: string;
  ok: boolean;
  status: NotificationStatus;
};

function defaultMessage(): string {
  return [
    `**${discordChannelTitle()}**`,
    "**Manual Test**",
    `Checked at: ${new Date().toISOString()}`,
    discordChannelInviteLink() ? `Join link: ${discordChannelInviteLink()}` : "",
    "",
    "This channel is ready for live trade signals and TP/SL updates."
  ].filter(Boolean).join("\n");
}

export async function sendTestDiscordAlert(): Promise<TestDiscordAlertResult> {
  if (!discordConfigured()) {
    return {
      ok: false,
      status: "skipped",
      error: "Discord is not configured in the current environment."
    };
  }

  const result = await sendDiscordText(defaultMessage());
  return {
    ok: result.status === "sent",
    status: result.status,
    error: result.error
  };
}
