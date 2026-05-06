"use client";

import { useEffect, useId, useState } from "react";
import TopstepConnectionPanel from "@/components/topstep/topstep-connection-panel";

export default function TopstepConnectionDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const drawerId = useId();

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

  return (
    <>
      <button
        aria-controls={drawerId}
        aria-expanded={isOpen}
        aria-label="Open TopstepX connection drawer"
        className="topstepDrawerButton"
        onClick={() => setIsOpen(true)}
        title="TopstepX connection"
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
            aria-label="Close TopstepX connection drawer"
            className="topstepDrawerBackdrop"
            onClick={() => setIsOpen(false)}
            type="button"
          />
          <aside aria-modal="true" className="topstepDrawerPanel" id={drawerId} role="dialog">
            <div className="topstepDrawerHead">
              <div>
                <span>ProjectX gateway</span>
                <strong>TopstepX Connection</strong>
              </div>
              <button aria-label="Close TopstepX connection drawer" onClick={() => setIsOpen(false)} type="button">
                <span aria-hidden="true">Close</span>
              </button>
            </div>
            <TopstepConnectionPanel />
          </aside>
        </div>
      ) : null}
    </>
  );
}
