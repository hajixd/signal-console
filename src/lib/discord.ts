import type { NotificationStatus, TradeAlert, TradeManagementEvent } from "./types";
import { formatTelegramManagementMessage, formatTelegramMessage, formatTelegramOutcomeMessage } from "./telegram";

const DISCORD_MAX_CONTENT_LENGTH = 1900;
const DISCORD_SEND_TIMEOUT_MS = 10_000;
const DISCORD_EVERYONE_MENTION = "@everyone";

type NotificationResult = { status: NotificationStatus; error?: string };

function discordWebhookUrl(): string | undefined {
  return process.env.DISCORD_WEBHOOK_URL?.trim() || process.env.DISCORD_ALERT_WEBHOOK_URL?.trim();
}

export function discordConfigured(): boolean {
  return Boolean(discordWebhookUrl());
}

export function discordChannelInviteLink(): string | undefined {
  return (
    process.env.DISCORD_CHANNEL_INVITE_LINK?.trim() ||
    process.env.DISCORD_INVITE_LINK?.trim() ||
    process.env.DISCORD_SERVER_INVITE_LINK?.trim()
  );
}

export function discordChannelTitle(): string {
  return process.env.DISCORD_CHANNEL_TITLE?.trim() || "Trading Bot Alerts";
}

function discordWebhookUsername(): string | undefined {
  return process.env.DISCORD_WEBHOOK_USERNAME?.trim() || undefined;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function telegramHtmlToDiscordMarkdown(value: string): string {
  const markdown = value
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(markdown);
}

function fitDiscordMessage(text: string): string {
  if (text.length <= DISCORD_MAX_CONTENT_LENGTH) return text;
  return `${text.slice(0, DISCORD_MAX_CONTENT_LENGTH - 24)}\n\n[message truncated]`;
}

export function formatDiscordText(text: string): string {
  const content = telegramHtmlToDiscordMarkdown(text).trim();
  if (!content) return "";
  return fitDiscordMessage(content.startsWith(DISCORD_EVERYONE_MENTION) ? content : `${DISCORD_EVERYONE_MENTION}\n${content}`);
}

export function formatDiscordMessage(trade: TradeAlert): string {
  return formatDiscordText(formatTelegramMessage(trade));
}

export function formatDiscordOutcomeMessage(trade: TradeAlert): string {
  return formatDiscordText(formatTelegramOutcomeMessage(trade));
}

export function formatDiscordManagementMessage(trade: TradeAlert, event: TradeManagementEvent): string {
  return formatDiscordText(formatTelegramManagementMessage(trade, event));
}

async function postDiscordContent(content: string): Promise<NotificationResult> {
  const webhookUrl = discordWebhookUrl();
  if (!webhookUrl) return { status: "skipped" };

  if (!content) return { status: "skipped" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCORD_SEND_TIMEOUT_MS);
  try {
    const username = discordWebhookUsername();
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        allowed_mentions: { parse: ["everyone"] },
        content,
        username
      })
    });

    if (!response.ok) {
      return { status: "failed", error: `${response.status}: ${(await response.text()).slice(0, 240)}` };
    }
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Discord request failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendDiscordText(text: string): Promise<NotificationResult> {
  return postDiscordContent(formatDiscordText(text));
}

export async function sendDiscord(trade: TradeAlert): Promise<NotificationResult> {
  return postDiscordContent(formatDiscordMessage(trade));
}

export async function sendDiscordOutcome(trade: TradeAlert): Promise<NotificationResult> {
  return postDiscordContent(formatDiscordOutcomeMessage(trade));
}

export async function sendDiscordManagement(trade: TradeAlert, event: TradeManagementEvent): Promise<NotificationResult> {
  return postDiscordContent(formatDiscordManagementMessage(trade, event));
}
