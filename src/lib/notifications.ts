import { sendDiscord, sendDiscordManagement, sendDiscordOutcome, sendDiscordText } from "./discord";
import { sendTelegram, sendTelegramManagement, sendTelegramOutcome, sendTelegramText } from "./telegram";
import type { NotificationStatus, TradeAlert, TradeManagementEvent } from "./types";

export type NotificationResult = { status: NotificationStatus; error?: string };

export type ChannelNotificationResult = {
  discord: NotificationResult;
  telegram: NotificationResult;
};

export function combinedNotificationStatus(result: ChannelNotificationResult): NotificationStatus {
  if (result.discord.status === "failed" || result.telegram.status === "failed") return "failed";
  if (result.discord.status === "sent" || result.telegram.status === "sent") return "sent";
  return "skipped";
}

export function combinedNotificationError(result: ChannelNotificationResult): string | undefined {
  return [
    result.telegram.error ? `Telegram: ${result.telegram.error}` : undefined,
    result.discord.error ? `Discord: ${result.discord.error}` : undefined
  ].filter((entry): entry is string => Boolean(entry)).join("; ") || undefined;
}

export async function sendTextNotification(text: string): Promise<ChannelNotificationResult> {
  const [telegram, discord] = await Promise.all([sendTelegramText(text), sendDiscordText(text)]);
  return { discord, telegram };
}

export async function sendTradeNotification(trade: TradeAlert): Promise<ChannelNotificationResult> {
  const [telegram, discord] = await Promise.all([sendTelegram(trade), sendDiscord(trade)]);
  return { discord, telegram };
}

export async function sendTradeOutcomeNotification(trade: TradeAlert): Promise<ChannelNotificationResult> {
  const [telegram, discord] = await Promise.all([sendTelegramOutcome(trade), sendDiscordOutcome(trade)]);
  return { discord, telegram };
}

export async function sendTradeManagementNotification(
  trade: TradeAlert,
  event: TradeManagementEvent
): Promise<ChannelNotificationResult> {
  const [telegram, discord] = await Promise.all([sendTelegramManagement(trade, event), sendDiscordManagement(trade, event)]);
  return { discord, telegram };
}
