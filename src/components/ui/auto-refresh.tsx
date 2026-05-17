"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type AutoRefreshProps = {
  intervalMs?: number;
};

export default function AutoRefresh({ intervalMs = 180_000 }: AutoRefreshProps) {
  const router = useRouter();
  const lastRefreshAtRef = useRef(Date.now());

  useEffect(() => {
    function refreshWhenVisible(force = false) {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (!force && now - lastRefreshAtRef.current < intervalMs) return;
        lastRefreshAtRef.current = now;
        router.refresh();
      }
    }

    const intervalRefresh = () => refreshWhenVisible(true);
    const opportunisticRefresh = () => refreshWhenVisible(false);
    const timer = window.setInterval(intervalRefresh, intervalMs);
    document.addEventListener("visibilitychange", opportunisticRefresh);
    window.addEventListener("focus", opportunisticRefresh);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", opportunisticRefresh);
      window.removeEventListener("focus", opportunisticRefresh);
    };
  }, [intervalMs, router]);

  return null;
}
