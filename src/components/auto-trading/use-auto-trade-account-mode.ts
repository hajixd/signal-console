"use client";

import { useEffect, useState } from "react";
import {
  AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT,
  savedAccountMode,
  type AutoTradeAccountMode
} from "@/components/auto-trading/auto-trade-account-mode";

export function useAutoTradeAccountMode(): AutoTradeAccountMode | null {
  const [accountMode, setAccountMode] = useState<AutoTradeAccountMode | null>(null);

  useEffect(() => {
    function syncAccountMode() {
      setAccountMode(savedAccountMode());
    }

    syncAccountMode();
    window.addEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
    return () => window.removeEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
  }, []);

  return accountMode;
}

export function useAutoTradeAdminMode(): boolean {
  return useAutoTradeAccountMode() === "Admin";
}
