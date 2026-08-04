const RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;
const DAILY_RESET_BUFFER_MS = 5 * 60_000;

let twelveDataUnavailableUntil = 0;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function twelveDataAvailable(now = Date.now()): boolean {
  return now >= twelveDataUnavailableUntil;
}

export function twelveDataCooldownRemainingMs(now = Date.now()): number {
  return Math.max(0, twelveDataUnavailableUntil - now);
}

export function markTwelveDataProviderFailure(error: unknown, now = Date.now()): void {
  const message = errorText(error).toLowerCase();
  const dailyQuotaFailure = /run out of api credits|credits for the day|daily.*(?:credit|limit)|next day/.test(message);
  const rateLimitFailure = dailyQuotaFailure || /(?:^|\D)429(?:\D|$)|rate.?limit|too many requests/.test(message);
  if (!rateLimitFailure) return;

  if (dailyQuotaFailure) {
    const nextUtcDay = new Date(now);
    nextUtcDay.setUTCHours(24, 0, 0, 0);
    twelveDataUnavailableUntil = Math.max(twelveDataUnavailableUntil, nextUtcDay.getTime() + DAILY_RESET_BUFFER_MS);
    return;
  }

  twelveDataUnavailableUntil = Math.max(twelveDataUnavailableUntil, now + RATE_LIMIT_COOLDOWN_MS);
}

export function resetMarketDataProviderHealthForTests(): void {
  twelveDataUnavailableUntil = 0;
}
