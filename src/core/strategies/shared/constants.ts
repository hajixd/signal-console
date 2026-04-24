import type { Side } from "@/lib/types";

export const LONG: Side = "long";
export const SHORT: Side = "short";

export const BUY = "buy";
export const SELL = "sell";
export const CLOSE = "close";

export const SESSION_OPEN_ET = {
  asia: 18 * 60,
  london: 3 * 60,
  pre_ny: 8 * 60 + 30,
  ny: 9 * 60 + 30
} as const;
