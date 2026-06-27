"use client";

import { useId, useState, type ReactNode } from "react";

type StatsView = "history" | "live";

type StrategyStatsTabsProps = {
  history: ReactNode;
  live: ReactNode;
};

export default function StrategyStatsTabs({ history, live }: StrategyStatsTabsProps) {
  const [view, setView] = useState<StatsView>("history");
  const id = useId();
  const tabs = [
    { id: "history" as const, label: "History", panel: history },
    { id: "live" as const, label: "Live Statistics", panel: live }
  ];

  return (
    <div className="statsViewTabs">
      <div className="historyViewSwitch" role="tablist" aria-label="Statistics source">
        {tabs.map((tab) => (
          <button
            aria-controls={`${id}-${tab.id}-panel`}
            aria-selected={view === tab.id}
            className={view === tab.id ? "active" : ""}
            id={`${id}-${tab.id}-tab`}
            key={tab.id}
            onClick={() => setView(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <div
          aria-labelledby={`${id}-${tab.id}-tab`}
          className="statsViewPanel"
          hidden={view !== tab.id}
          id={`${id}-${tab.id}-panel`}
          key={tab.id}
          role="tabpanel"
        >
          {view === tab.id ? tab.panel : null}
        </div>
      ))}
    </div>
  );
}
