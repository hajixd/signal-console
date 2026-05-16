"use client";

export const DASHBOARD_LOADING_EVENT = "trading-bot:dashboard-loading";

type DashboardLoadingEventDetail = {
  active: boolean;
  activeCount: number;
  label?: string;
  progress?: number;
  source: string;
};

type DashboardLoadingSourceState = {
  label?: string;
  progress?: number;
};

type DashboardLoadingUpdate =
  | boolean
  | {
      active: boolean;
      label?: string;
      progress?: number;
    };

export type DashboardLoadingState = {
  active: boolean;
  activeCount: number;
  label?: string;
  progress?: number;
};

declare global {
  interface Window {
    __tradingBotDashboardLoadingSources?: Map<string, DashboardLoadingSourceState>;
  }
}

function sources(): Map<string, DashboardLoadingSourceState> {
  if (!(window.__tradingBotDashboardLoadingSources instanceof Map)) {
    window.__tradingBotDashboardLoadingSources = new Map<string, DashboardLoadingSourceState>();
  }
  return window.__tradingBotDashboardLoadingSources;
}

function clampProgress(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function loadingState(source = ""): DashboardLoadingState {
  const activeSources = sources();
  const entries = [...activeSources.values()];
  const progressValues = entries.map((entry) => clampProgress(entry.progress) ?? 0.12);
  const progress = progressValues.length
    ? progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length
    : undefined;
  const label = [...activeSources.entries()].find(([key]) => key === source)?.[1]?.label ?? entries.find((entry) => entry.label)?.label;

  return {
    active: activeSources.size > 0,
    activeCount: activeSources.size,
    label,
    progress
  };
}

export function readDashboardLoadingState(): DashboardLoadingState {
  if (typeof window === "undefined") return { active: false, activeCount: 0 };
  return loadingState();
}

export function readDashboardLoadingActive(): boolean {
  return readDashboardLoadingState().active;
}

export function emitDashboardLoading(source: string, update: DashboardLoadingUpdate): void {
  if (typeof window === "undefined") return;
  const active = typeof update === "boolean" ? update : update.active;
  const activeSources = sources();
  if (active) {
    activeSources.set(source, {
      label: typeof update === "boolean" ? undefined : update.label,
      progress: typeof update === "boolean" ? undefined : clampProgress(update.progress)
    });
  } else {
    activeSources.delete(source);
  }
  const state = loadingState(source);

  window.dispatchEvent(
    new CustomEvent<DashboardLoadingEventDetail>(DASHBOARD_LOADING_EVENT, {
      detail: {
        ...state,
        source
      }
    })
  );
}

export function subscribeDashboardLoading(listener: (state: DashboardLoadingState) => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onLoadingChange = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail?.active === "boolean") {
      listener({
        active: event.detail.active,
        activeCount: typeof event.detail.activeCount === "number" ? event.detail.activeCount : event.detail.active ? 1 : 0,
        label: typeof event.detail.label === "string" ? event.detail.label : undefined,
        progress: clampProgress(event.detail.progress)
      });
      return;
    }
    listener(readDashboardLoadingState());
  };

  listener(readDashboardLoadingState());
  window.addEventListener(DASHBOARD_LOADING_EVENT, onLoadingChange);

  return () => window.removeEventListener(DASHBOARD_LOADING_EVENT, onLoadingChange);
}
