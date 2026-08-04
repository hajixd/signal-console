"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AutoTradingConnectionPanel from "@/components/auto-trading/auto-trading-connection-panel";
import Mt5EaStatusPanel from "@/components/auto-trading/mt5-ea-status-panel";
import { autoTradeMarketLabel, type AutoTradeMarket } from "@/lib/auto-trade-platforms";

type AutoTradingConnectionDrawerProps = {
  market: AutoTradeMarket;
};

export default function AutoTradingConnectionDrawer({ market }: AutoTradingConnectionDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const drawerId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const marketLabel = autoTradeMarketLabel(market);

  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : triggerButtonRef.current;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          drawerRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ) ?? []
        ).filter((element) => !element.hidden && element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, [isOpen]);

  useEffect(() => {
    setIsOpen(false);
  }, [market]);

  const drawer = isOpen ? (
    <div className="topstepDrawerLayer">
      <button
        aria-label="Close auto-trading drawer"
        className="topstepDrawerBackdrop"
        onClick={() => setIsOpen(false)}
        type="button"
      />
      <aside aria-label={`${marketLabel} auto-trading accounts`} aria-modal="true" className="topstepDrawerPanel" id={drawerId} ref={drawerRef} role="dialog">
        <div className="topstepDrawerHead">
          <div>
            <span>{marketLabel} execution</span>
            <strong>Auto-Trading Accounts</strong>
          </div>
          <button aria-label="Close auto-trading drawer" onClick={() => setIsOpen(false)} ref={closeButtonRef} type="button">
            <span aria-hidden="true">Close</span>
          </button>
        </div>
        <AutoTradingConnectionPanel market={market} />
        {market === "forex" ? <Mt5EaStatusPanel /> : null}
      </aside>
    </div>
  ) : null;

  return (
    <>
      <button
        aria-controls={drawerId}
        aria-expanded={isOpen}
        aria-label={`Open ${marketLabel} auto-trading drawer`}
        className="topstepDrawerButton"
        onClick={() => setIsOpen(true)}
        ref={triggerButtonRef}
        title={`${marketLabel} auto trading`}
        type="button"
      >
        <span className="topstepDrawerLabel">Auto-Trade</span>
      </button>

      {drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}
