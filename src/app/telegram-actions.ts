"use server";

import { sendTelegramText, telegramConfigured } from "@/lib/telegram";

export type TestTelegramAlertResult = {
  error?: string;
  ok: boolean;
  status: "sent" | "skipped" | "failed";
};

function defaultMessage(): string {
  return [
    "Trading Bot test alert",
    `Checked at ${new Date().toISOString()}`,
    "",
    "This is a manual verification alert from the dashboard header."
  ].join("\n");
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
