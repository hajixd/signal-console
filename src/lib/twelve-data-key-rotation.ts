const MINUTE_RESET_BUFFER_MS = 5_000;
const DAILY_RESET_BUFFER_MS = 5 * 60_000;

function normalizedKeys(keys: string[]): string[] {
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
}

export function twelveDataKeyCooldownUntil(error: unknown, now = Date.now()): number | undefined {
  const message = errorText(error);
  const dailyQuotaFailure = /credits for the day|daily.*(?:credit|limit)|next day/.test(message);
  if (dailyQuotaFailure) {
    const nextUtcDay = new Date(now);
    nextUtcDay.setUTCHours(24, 0, 0, 0);
    return nextUtcDay.getTime() + DAILY_RESET_BUFFER_MS;
  }

  const minuteQuotaFailure =
    /current minute|per[- ]minute|next minute|api credits.*minute|run out of api credits|(?:^|\D)429(?:\D|$)|rate.?limit|too many requests/.test(
      message
    );
  if (!minuteQuotaFailure) return undefined;

  const nextMinute = Math.floor(now / 60_000) * 60_000 + 60_000;
  return nextMinute + MINUTE_RESET_BUFFER_MS;
}

export class TwelveDataKeyRotation {
  private cooldowns = new Map<string, number>();
  private cursor = 0;
  private signature = "";

  orderedKeys(keys: string[], now = Date.now()): string[] {
    const uniqueKeys = normalizedKeys(keys);
    const signature = uniqueKeys.join("\u0000");
    if (signature !== this.signature) {
      this.signature = signature;
      this.cursor = 0;
      this.cooldowns = new Map([...this.cooldowns].filter(([key]) => uniqueKeys.includes(key)));
    }

    const available = uniqueKeys.filter((key) => (this.cooldowns.get(key) ?? 0) <= now);
    if (!available.length) return [];

    const start = this.cursor % available.length;
    this.cursor = (this.cursor + 1) % available.length;
    return available.map((_, index) => available[(start + index) % available.length]!);
  }

  markFailure(key: string, error: unknown, now = Date.now()): void {
    const unavailableUntil = twelveDataKeyCooldownUntil(error, now);
    if (unavailableUntil === undefined) return;
    this.cooldowns.set(key, Math.max(this.cooldowns.get(key) ?? 0, unavailableUntil));
  }

  markSuccess(key: string): void {
    this.cooldowns.delete(key);
  }

  reset(): void {
    this.cooldowns.clear();
    this.cursor = 0;
    this.signature = "";
  }
}

export const sharedTwelveDataKeyRotation = new TwelveDataKeyRotation();
