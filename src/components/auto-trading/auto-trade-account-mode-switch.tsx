"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT,
  AUTO_TRADE_ADMIN_ACCESS_CODE,
  cleanAccessCode,
  clearSavedAccountMode,
  saveAccountMode,
  savedAccountMode,
  type AutoTradeAccountMode
} from "@/components/auto-trading/auto-trade-account-mode";

export default function AutoTradeAccountModeSwitch() {
  const [isReady, setIsReady] = useState(false);
  const [accountMode, setAccountMode] = useState<AutoTradeAccountMode | null>(null);
  const [accountEntryMode, setAccountEntryMode] = useState<AutoTradeAccountMode | null>(null);
  const [adminCodeInput, setAdminCodeInput] = useState("");
  const [accountAccessError, setAccountAccessError] = useState("");
  const adminCodeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function syncAccountMode() {
      setAccountMode(savedAccountMode());
      setAccountEntryMode(null);
      setAdminCodeInput("");
      setAccountAccessError("");
    }

    syncAccountMode();
    setIsReady(true);
    window.addEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
    return () => window.removeEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
  }, []);

  useEffect(() => {
    if (accountEntryMode !== "Admin" || accountMode) return;
    const frame = window.requestAnimationFrame(() => adminCodeInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [accountEntryMode, accountMode]);

  function grantAccountMode(mode: AutoTradeAccountMode) {
    setAccountMode(mode);
    setAccountEntryMode(null);
    setAdminCodeInput("");
    setAccountAccessError("");
    saveAccountMode(mode);
  }

  function handleAdminUnlock(code = adminCodeInput) {
    if (code.length < 5) return;
    if (code === AUTO_TRADE_ADMIN_ACCESS_CODE) {
      grantAccountMode("Admin");
      return;
    }

    setAdminCodeInput("");
    setAccountAccessError("Incorrect code");
    window.requestAnimationFrame(() => adminCodeInputRef.current?.focus());
  }

  function handleAdminSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleAdminUnlock();
  }

  function handleSwitchAccountMode() {
    setAccountMode(null);
    setAccountEntryMode(null);
    setAdminCodeInput("");
    setAccountAccessError("");
    clearSavedAccountMode();
  }

  if (!isReady) return null;

  if (accountMode) {
    return (
      <div className="autoTradeModeBar autoTradeTopModeBar">
        <span className={`autoTradeModeBadge ${accountMode.toLowerCase()}`}>{accountMode}</span>
        <button type="button" onClick={handleSwitchAccountMode}>
          Switch
        </button>
      </div>
    );
  }

  return (
    <div className="autoTradeTopModePanel">
      {accountEntryMode === "Admin" ? (
        <form className="autoTradePinForm autoTradeTopPinForm" onClick={() => adminCodeInputRef.current?.focus()} onSubmit={handleAdminSubmit}>
          <input
            aria-label="Admin code"
            autoFocus
            className="autoTradePinHidden"
            inputMode="numeric"
            maxLength={5}
            onChange={(event) => {
              const nextValue = cleanAccessCode(event.target.value, 5);
              setAdminCodeInput(nextValue);
              setAccountAccessError("");
              if (nextValue.length === 5) handleAdminUnlock(nextValue);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setAccountEntryMode(null);
                setAdminCodeInput("");
                setAccountAccessError("");
              }

              if (event.key === "Backspace" && adminCodeInput.length === 0) {
                setAccountEntryMode(null);
                setAccountAccessError("");
              }
            }}
            pattern="[0-9]*"
            ref={adminCodeInputRef}
            value={adminCodeInput}
          />
          <div className="autoTradePinGrid autoTradeCompactPinGrid" aria-hidden>
            {Array.from({ length: 5 }, (_, index) => {
              const digit = adminCodeInput[index] ?? "";
              const isActiveSlot = adminCodeInput.length === index && adminCodeInput.length < 5;
              return (
                <span
                  className={`autoTradePinBox${digit ? " filled" : ""}${isActiveSlot ? " active" : ""}`}
                  key={`top-auto-trade-pin-${index + 1}`}
                >
                  {digit}
                </span>
              );
            })}
          </div>
          {accountAccessError ? <div className="autoTradeGateError">{accountAccessError}</div> : null}
        </form>
      ) : (
        <div className="autoTradeChoiceGrid autoTradeTopChoiceGrid">
          <button
            className="autoTradeChoiceCard"
            onClick={() => {
              setAccountEntryMode("Admin");
              setAdminCodeInput("");
              setAccountAccessError("");
            }}
            type="button"
          >
            Admin
          </button>
          <button className="autoTradeChoiceCard" onClick={() => grantAccountMode("User")} type="button">
            User
          </button>
        </div>
      )}
    </div>
  );
}
