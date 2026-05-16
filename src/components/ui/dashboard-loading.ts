"use client";

export const DASHBOARD_LOADING_EVENT = "trading-bot:dashboard-loading";

type DashboardLoadingEventDetail = {
  active: boolean;
  activeCount: number;
  source: string;
};

declare global {
  interface Window {
    __tradingBotDashboardLoadingSources?: Set<string>;
  }
}

function sources(): Set<string> {
  if (!window.__tradingBotDashboardLoadingSources) {
    window.__tradingBotDashboardLoadingSources = new Set<string>();
  }
  return window.__tradingBotDashboardLoadingSources;
}

export function readDashboardLoadingActive(): boolean {
  if (typeof window === "undefined") return false;
  return sources().size > 0;
}

export function emitDashboardLoading(source: string, active: boolean): void {
  if (typeof window === "undefined") return;
  const activeSources = sources();
  if (active) {
    activeSources.add(source);
  } else {
    activeSources.delete(source);
  }

  window.dispatchEvent(
    new CustomEvent<DashboardLoadingEventDetail>(DASHBOARD_LOADING_EVENT, {
      detail: {
        active: activeSources.size > 0,
        activeCount: activeSources.size,
        source
      }
    })
  );
}

export function subscribeDashboardLoading(listener: (active: boolean) => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onLoadingChange = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail?.active === "boolean") {
      listener(event.detail.active);
      return;
    }
    listener(readDashboardLoadingActive());
  };

  listener(readDashboardLoadingActive());
  window.addEventListener(DASHBOARD_LOADING_EVENT, onLoadingChange);

  return () => window.removeEventListener(DASHBOARD_LOADING_EVENT, onLoadingChange);
}
