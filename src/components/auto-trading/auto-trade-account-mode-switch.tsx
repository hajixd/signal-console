"use client";

import { useEffect, useState } from "react";
import {
  AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT,
  clearSavedAccountMode,
  savedAccountMode,
  type AutoTradeAccountMode
} from "@/components/auto-trading/auto-trade-account-mode";

export default function AutoTradeAccountModeSwitch() {
  const [isReady, setIsReady] = useState(false);
  const [accountMode, setAccountMode] = useState<AutoTradeAccountMode | null>(null);

  useEffect(() => {
    function syncAccountMode() {
      setAccountMode(savedAccountMode());
    }

    syncAccountMode();
    setIsReady(true);
    window.addEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
    return () => window.removeEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
  }, []);

  function handleSwitchAccountMode() {
    clearSavedAccountMode();
    void fetch("/api/auto-trading/access-code", { method: "DELETE" }).catch(() => undefined);
  }

  if (!isReady || !accountMode) return null;

  return (
    <div className="autoTradeModeBar autoTradeTopModeBar">
      <button type="button" onClick={handleSwitchAccountMode}>
        Switch
      </button>
      <span className={`autoTradeModeBadge ${accountMode.toLowerCase()}`}>{accountMode}</span>
    </div>
  );
}
