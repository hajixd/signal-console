"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT,
  cleanAccessCode,
  type AutoTradeAccountMode,
  savedAccountMode,
  saveAccountMode
} from "@/components/auto-trading/auto-trade-account-mode";

export default function AutoTradeAccountGate() {
  const [isReady, setIsReady] = useState(false);
  const [accountMode, setAccountMode] = useState<AutoTradeAccountMode | null>(null);
  const [accountEntryMode, setAccountEntryMode] = useState<AutoTradeAccountMode | null>(null);
  const [adminCodeInput, setAdminCodeInput] = useState("");
  const [accountAccessError, setAccountAccessError] = useState("");
  const [isUnlockingAdmin, setIsUnlockingAdmin] = useState(false);
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
    if (!isReady || accountMode) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && accountEntryMode === "Admin") {
        setAccountEntryMode(null);
        setAdminCodeInput("");
        setAccountAccessError("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountEntryMode, accountMode, isReady]);

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

  async function handleAdminUnlock(code = adminCodeInput) {
    if (code.length < 5 || isUnlockingAdmin) return;

    setIsUnlockingAdmin(true);
    try {
      const response = await fetch("/api/auto-trading/access-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessCode: code,
          type: "admin"
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Incorrect code.");
      }
      grantAccountMode("Admin");
      return;
    } catch (error) {
      setAdminCodeInput("");
      setAccountAccessError(error instanceof Error ? error.message : "Incorrect code");
      window.requestAnimationFrame(() => adminCodeInputRef.current?.focus());
    } finally {
      setIsUnlockingAdmin(false);
    }
  }

  function handleAdminSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleAdminUnlock();
  }

  if (!isReady || accountMode) return null;

  const gate = (
    <div className="topstepDrawerLayer autoTradeStartupGateLayer" role="presentation">
      <div className="topstepDrawerBackdrop" />
      <section aria-modal="true" className="autoTradeStartupGate" role="dialog">
        <div className="autoTradeGatePanel">
          {accountEntryMode === "Admin" ? (
            <form className="autoTradePinForm" onClick={() => adminCodeInputRef.current?.focus()} onSubmit={handleAdminSubmit}>
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
                  if (nextValue.length === 5) void handleAdminUnlock(nextValue);
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
              <div className="autoTradePinGrid" aria-hidden>
                {Array.from({ length: 5 }, (_, index) => {
                  const digit = adminCodeInput[index] ?? "";
                  const isActiveSlot = adminCodeInput.length === index && adminCodeInput.length < 5;
                  return (
                    <button
                      aria-label={`Digit ${index + 1}`}
                      className={`autoTradePinBox${digit ? " filled" : ""}${isActiveSlot ? " active" : ""}${isUnlockingAdmin ? " busy" : ""}`}
                      key={`startup-auto-trade-pin-${index + 1}`}
                      onClick={() => adminCodeInputRef.current?.focus()}
                      tabIndex={-1}
                      type="button"
                    >
                      {digit}
                    </button>
                  );
                })}
              </div>
              {accountAccessError ? <div className="autoTradeGateError">{accountAccessError}</div> : null}
            </form>
          ) : (
            <div className="autoTradeChoiceGrid">
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
      </section>
    </div>
  );

  return createPortal(gate, document.body);
}
