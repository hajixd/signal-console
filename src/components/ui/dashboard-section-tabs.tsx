"use client";

import { Children, type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";

export type DashboardSectionTab = {
  icon: "cluster" | "history" | "live" | "replay" | "stats" | "storage" | "strategies" | "sync" | "telegram";
  id: string;
  label: string;
  meta?: string;
};

type DashboardSectionTabsProps = {
  children: ReactNode;
  tabs: DashboardSectionTab[];
};

function tabFromHash(tabs: DashboardSectionTab[]): string | null {
  if (typeof window === "undefined") return null;
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  return tabs.some((tab) => tab.id === hash) ? hash : null;
}

function iconClass(icon: DashboardSectionTab["icon"]): string {
  return `mobileTabIcon mobileTabIcon${icon.charAt(0).toUpperCase()}${icon.slice(1)}`;
}

export default function DashboardSectionTabs({ children, tabs }: DashboardSectionTabsProps) {
  const panels = Children.toArray(children);
  const defaultTab = tabs[0]?.id ?? "";
  const tabIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs]);
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    const hashedTab = tabFromHash(tabs);
    setActiveTab((current) => (hashedTab ?? (tabIds.has(current) ? current : defaultTab)));

    function handleHashChange() {
      const nextTab = tabFromHash(tabs);
      if (nextTab) setActiveTab(nextTab);
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [defaultTab, tabIds, tabs]);

  function activateTab(tabId: string, scrollIntoView = true) {
    if (!tabIds.has(tabId)) return;
    setActiveTab(tabId);
    if (typeof window !== "undefined") {
      const nextUrl = `${window.location.pathname}${window.location.search}#${encodeURIComponent(tabId)}`;
      window.history.replaceState(null, "", nextUrl);
      if (scrollIntoView) {
        window.requestAnimationFrame(() => {
          document.getElementById("dashboard-section-tabs")?.scrollIntoView({ block: "start", behavior: "smooth" });
        });
      }
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = index === 0 ? tabs.length - 1 : index - 1;
    if (event.key === "ArrowRight") nextIndex = index === tabs.length - 1 ? 0 : index + 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;

    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    activateTab(nextTab.id);
    window.requestAnimationFrame(() => document.getElementById(`dashboard-tab-${nextTab.id}`)?.focus());
  }

  return (
    <div className="dashboardSectionTabsShell" id="dashboard-section-tabs">
      <div className="dashboardSectionTabsHeader">
        <div className="dashboardSectionTabs" role="tablist" aria-label="Dashboard sections">
          {tabs.map((tab, index) => {
            const selected = tab.id === activeTab;
            return (
              <button
                aria-controls={`dashboard-panel-${tab.id}`}
                aria-selected={selected}
                className={`dashboardSectionTab${selected ? " is-active" : ""}`}
                id={`dashboard-tab-${tab.id}`}
                key={tab.id}
                onClick={() => activateTab(tab.id, false)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <span>{tab.label}</span>
                {tab.meta ? <small>{tab.meta}</small> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="dashboardTabPanels">
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTab;
          return (
            <div
              aria-labelledby={`dashboard-tab-${tab.id}`}
              className={`dashboardTabPanel${selected ? " is-active" : ""}`}
              hidden={!selected}
              id={`dashboard-panel-${tab.id}`}
              key={tab.id}
              role="tabpanel"
            >
              {panels[index]}
            </div>
          );
        })}
      </div>

      <nav className="mobileBottomTabbar dashboardSectionMobileTabs" aria-label="Dashboard section tabs" role="tablist">
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTab;
          return (
            <button
              aria-controls={`dashboard-panel-${tab.id}`}
              aria-selected={selected}
              className={selected ? "is-active" : ""}
              key={tab.id}
              onClick={() => activateTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span className={iconClass(tab.icon)} aria-hidden="true" />
              <strong>{tab.label}</strong>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
