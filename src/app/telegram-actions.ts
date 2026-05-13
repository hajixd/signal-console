"use server";

import { sendTelegramText, telegramConfigured, telegramGroupInviteLink } from "@/lib/telegram";

export type TestTelegramAlertResult = {
  error?: string;
  ok: boolean;
  status: "sent" | "skipped" | "failed";
};

function defaultMessage(): string {
  return [
    "<b>Trading Bot Alerts</b>",
    "<b>Manual Test</b>",
    `Checked at: ${new Date().toISOString()}`,
    telegramGroupInviteLink() ? `Join link: ${telegramGroupInviteLink()}` : "",
    "",
    "This group is ready for live trade signals and TP/SL updates."
  ].filter(Boolean).join("\n");
}

export async function sendTestTelegramAlert(): Promise<TestTelegramAlertResult> {
  if (!telegramConfigured()) {
    return {
      ok: false,
      status: "skipped",
      error: "Telegram is not configured in the current environment."
    };
  }

  const result = await sendTelegramText(defaultMessage());
  return {
    ok: result.status === "sent",
    status: result.status,
    error: result.error
  };
}
