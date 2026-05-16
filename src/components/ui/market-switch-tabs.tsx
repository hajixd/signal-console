"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { subscribeDashboardLoading } from "@/components/ui/dashboard-loading";

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
  const [hasPageLoading, setHasPageLoading] = useState(false);

  useEffect(() => {
    setPendingMarket(null);
  }, [activeMarket]);

  useEffect(() => subscribeDashboardLoading(setHasPageLoading), []);

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
  const isLoading = Boolean(pendingMarket || isPending || hasPageLoading);

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
        {switchingLabel ? (
          <span className="marketSwitchStatus" aria-live="polite">
            Switching to {switchingLabel}
          </span>
        ) : null}
      </nav>
      <div className="marketLoadingBar" aria-hidden={!isLoading}>
        <span />
      </div>
    </div>
  );
}
