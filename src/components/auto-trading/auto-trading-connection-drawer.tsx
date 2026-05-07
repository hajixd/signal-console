"use client";

import { useEffect, useId, useState } from "react";
import AutoTradingConnectionPanel from "@/components/auto-trading/auto-trading-connection-panel";
import { autoTradeMarketLabel, type AutoTradeMarket } from "@/lib/auto-trade-platforms";

type AutoTradingConnectionDrawerProps = {
  market: AutoTradeMarket;
};

export default function AutoTradingConnectionDrawer({ market }: AutoTradingConnectionDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const drawerId = useId();
  const marketLabel = autoTradeMarketLabel(market);

  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    setIsOpen(false);
  }, [market]);

  return (
    <>
      <button
        aria-controls={drawerId}
        aria-expanded={isOpen}
        aria-label={`Open ${marketLabel} auto-trading drawer`}
        className="topstepDrawerButton"
        onClick={() => setIsOpen(true)}
        title={`${marketLabel} auto trading`}
        type="button"
      >
        <span aria-hidden="true" className="topstepDrawerIcon">
          <span />
          <span />
          <span />
        </span>
      </button>

      {isOpen ? (
        <div className="topstepDrawerLayer">
          <button
            aria-label="Close auto-trading drawer"
            className="topstepDrawerBackdrop"
            onClick={() => setIsOpen(false)}
            type="button"
          />
          <aside aria-modal="true" className="topstepDrawerPanel" id={drawerId} role="dialog">
            <div className="topstepDrawerHead">
              <div>
                <span>{marketLabel} execution</span>
                <strong>Auto-Trading Accounts</strong>
              </div>
              <button aria-label="Close auto-trading drawer" onClick={() => setIsOpen(false)} type="button">
                <span aria-hidden="true">Close</span>
              </button>
            </div>
            <AutoTradingConnectionPanel market={market} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
