export const AUTO_TRADE_ACCOUNT_MODE_STORAGE_KEY = "tradingbot-auto-trade-account-mode";
export const AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT = "tradingbot:auto-trade-account-mode-change";
export const AUTO_TRADE_ACCESS_CODE_MAX_LENGTH = 12;

export type AutoTradeAccountMode = "Admin" | "User";

export function cleanAccessCode(value: string, maxLength = AUTO_TRADE_ACCESS_CODE_MAX_LENGTH): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

export function savedAccountMode(): AutoTradeAccountMode | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(AUTO_TRADE_ACCOUNT_MODE_STORAGE_KEY);
  return value === "Admin" || value === "User" ? value : null;
}

export function saveAccountMode(mode: AutoTradeAccountMode): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(AUTO_TRADE_ACCOUNT_MODE_STORAGE_KEY, mode);
  window.dispatchEvent(new Event(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT));
}

export function clearSavedAccountMode(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(AUTO_TRADE_ACCOUNT_MODE_STORAGE_KEY);
  window.dispatchEvent(new Event(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT));
}
