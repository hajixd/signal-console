"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { subscribeDashboardLoading, type DashboardLoadingState } from "@/components/ui/dashboard-loading";

type MarketSwitchTab = {
  key: "forex" | "futures";
  label: string;
};

type MarketSwitchTabsProps = {
  activeMarket: MarketSwitchTab["key"];
  persistActiveMarket?: (market: MarketSwitchTab["key"]) => Promise<void>;
  tabs: MarketSwitchTab[];
};

export default function MarketSwitchTabs({ activeMarket, persistActiveMarket, tabs }: MarketSwitchTabsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pendingMarket, setPendingMarket] = useState<MarketSwitchTab["key"] | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState<DashboardLoadingState>({ active: false, activeCount: 0 });
  const [routeProgress, setRouteProgress] = useState(0);

  useEffect(() => {
    setPendingMarket(null);
  }, [activeMarket]);

  useEffect(() => subscribeDashboardLoading(setDashboardLoading), []);

  useEffect(() => {
    if (!pendingMarket && !isPending) {
      setRouteProgress(0);
      return;
    }

    setRouteProgress((current) => Math.max(current, 0.18));
    const timer = window.setInterval(() => {
      setRouteProgress((current) => Math.min(0.88, current + (0.9 - current) * 0.14));
    }, 180);

    return () => window.clearInterval(timer);
  }, [isPending, pendingMarket]);

  const hrefs = useMemo(() => {
    return Object.fromEntries(
      tabs.map((tab) => {
        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.set("market", tab.key);
        return [tab.key, `${pathname}?${nextParams.toString()}`];
      })
    ) as Record<MarketSwitchTab["key"], string>;
  }, [pathname, searchParams, tabs]);

  const switchingLabel = pendingMarket ? tabs.find((tab) => tab.key === pendingMarket)?.label : null;
  const isLoading = Boolean(pendingMarket || isPending || dashboardLoading.active);
  const progressValue = dashboardLoading.active ? dashboardLoading.progress ?? 0.12 : pendingMarket || isPending ? routeProgress : 0;
  const progressPct = Math.round(Math.max(0, Math.min(1, progressValue)) * 100);
  const statusLabel = switchingLabel ? `Switching to ${switchingLabel}` : dashboardLoading.label ?? null;

  return (
    <div className={`market-tabs-shell${isLoading ? " isLoading" : ""}`}>
      <nav className="market-tabs" aria-busy={isLoading} aria-label="Market view">
        {tabs.map((tab) => {
          const isActive = activeMarket === tab.key;
          const isTarget = pendingMarket === tab.key;
          return (
            <a
              aria-current={isActive ? "page" : undefined}
              className={`market-tab${isActive ? " active" : ""}${isTarget ? " isPending" : ""}`}
              href={hrefs[tab.key]}
              key={tab.key}
              onClick={(event) => {
                if (isActive) return;
                event.preventDefault();
                setPendingMarket(tab.key);
                startTransition(() => {
                  if (persistActiveMarket) {
                    void persistActiveMarket(tab.key).catch((error) => console.error("Failed to save active market", error));
                  }
                  router.push(hrefs[tab.key], { scroll: false });
                });
              }}
            >
              {tab.label}
            </a>
          );
        })}
        {statusLabel ? (
          <span className="marketSwitchStatus" aria-live="polite">
            {statusLabel}
          </span>
        ) : null}
      </nav>
      <div
        aria-hidden={!isLoading}
        aria-label={statusLabel ?? "Dashboard loading"}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={isLoading ? progressPct : undefined}
        className="marketLoadingBar isDeterminate"
        role={isLoading ? "progressbar" : undefined}
      >
        <span style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}
