"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, FormEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import AutoTradingConnectionPanel from "@/components/auto-trading/auto-trading-connection-panel";
import {
  AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT,
  cleanAccessCode,
  savedAccountMode,
  saveAccountMode,
  type AutoTradeAccountMode
} from "@/components/auto-trading/auto-trade-account-mode";
import { useAutoTradeAdminMode } from "@/components/auto-trading/use-auto-trade-account-mode";
import {
  type StrategyEditOption,
  type StrategyEditSeedMap,
  useStrategyEdits
} from "@/components/strategies/strategy-edits-store";
import { adjustTradeHistoryRows } from "@/components/trades/adjust-trade-history-rows";
import {
  BacktestTradeMiniChart,
  tradePathDurationLabel,
  tradePathStats,
  withOpenTradeChartMark,
  type TradeHistoryRow
} from "@/components/trades/trade-history";
import LocalDateTime, { formatLocalDateTimeParts } from "@/components/ui/local-date-time";
import { type AutoTradeMarket } from "@/lib/auto-trade-platforms";
import { type TradeChartBar, type TradeChartTimeframe } from "@/components/trades/trade-price-chart";
import { mergeLiveOpenTradeBar } from "@/lib/open-trade-chart";

type MobileTradingTab = "history" | "alerts" | "sync" | "autotrade" | "settings";

type MobileTradingDashboardProps = {
  activeMarket: AutoTradeMarket;
  customScaleRange?: CustomScaleRangeSeed;
  discordChannelLink?: string | null;
  historyRows: TradeHistoryRow[];
  initialTheme?: "dark" | "light";
  latestHistoryTradeAt?: string;
  latestLiveAlertAt?: string;
  liveAlertRows: TradeHistoryRow[];
  marketLabel: string;
  persistedStrategyEdits?: StrategyEditSeedMap;
  persistActiveMarket?: (market: AutoTradeMarket) => Promise<void>;
  persistTheme?: (theme: MobileTheme) => Promise<void>;
  strategies: StrategyEditOption[];
  syncSummary?: MobileSyncSummary;
  telegramGroupLink?: string | null;
};

type MobileTheme = "dark" | "light";
type MobileSyncTone = string;

type MobileSyncMetric = {
  label: string;
  title?: string;
  tone?: MobileSyncTone;
  value: string;
};

type MobileSyncSection = {
  issues?: string[];
  metrics: MobileSyncMetric[];
  state: string;
  status: string;
  title: string;
  updatedAt?: string;
};

type MobileSyncSummary = {
  detail: string;
  headline: string;
  sections: MobileSyncSection[];
};

type CustomScaleRangeSeed = {
  riskCeiling?: unknown;
  riskFloor?: unknown;
  targetCeiling?: unknown;
  targetFloor?: unknown;
};

type MobileChartState = {
  bars: TradeChartBar[];
  message?: string;
  status: "idle" | "loading" | "ready" | "error";
};

type MobileChartPayload = {
  bars?: TradeChartBar[];
  error?: string;
  timeframe?: TradeChartTimeframe;
};

type MobileProjectXLiveQuotePayload = {
  bar?: Omit<TradeChartBar, "index"> & { index?: number };
};

type MobileHistoryStats = {
  averageLoss: string;
  averageTrade: string;
  averageTradeTone: "down" | "neutral" | "up";
  averageWin: string;
  netPnl: string;
  netPnlTone: "down" | "neutral" | "up";
  profitFactor: string;
  winRate: string;
};

type MobileLoadingController = {
  hideLoading: () => void;
  showLoading: (label: string, duration?: number | null) => void;
};

const THEME_STORAGE_KEY = "trading-bot-theme";
const LEGACY_THEME_STORAGE_KEY = "signal-console-theme";
const TRADE_CHART_CONTEXT_CANDLES = 240;
const OPEN_TRADE_CHART_REFRESH_MS = 30_000;
const PROJECTX_LIVE_QUOTE_REFRESH_MS = 4_000;

const mobileTabs: Array<{ id: MobileTradingTab; label: string }> = [
  { id: "alerts", label: "Alerts" },
  { id: "history", label: "History" },
  { id: "sync", label: "Sync" },
  { id: "autotrade", label: "Auto" },
  { id: "settings", label: "Settings" }
];

function useLocalHeaderParts(value?: string): { date: string; time: string } {
  const [parts, setParts] = useState<{ date: string; time: string }>({ date: "No activity yet", time: "" });

  useEffect(() => {
    const nextParts = formatLocalDateTimeParts(value, "No activity yet");
    setParts(nextParts ?? { date: "No activity yet", time: "" });
  }, [value]);

  return parts;
}

function applyMobileTheme(theme: MobileTheme) {
  document.documentElement.classList.add("mobile-mode-transitioning");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.setTimeout(() => document.documentElement.classList.remove("mobile-mode-transitioning"), 360);
}

function formatMobileMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    minimumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
    signDisplay: value > 0 ? "always" : "auto",
    style: "currency"
  }).format(value);
}

function formatMobileRatio(value: number): string {
  if (!Number.isFinite(value)) return "Max";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(value);
}

function mobileHistoryStats(rows: TradeHistoryRow[]): MobileHistoryStats {
  const scoredRows = rows.filter((row) => Number.isFinite(row.pnlDollars) && !row.exitReasonLabel.toLowerCase().includes("still open"));
  const wins = scoredRows.filter((row) => row.pnlDollars > 0);
  const losses = scoredRows.filter((row) => row.pnlDollars < 0);
  const grossWin = wins.reduce((sum, row) => sum + row.pnlDollars, 0);
  const grossLoss = Math.abs(losses.reduce((sum, row) => sum + row.pnlDollars, 0));
  const netPnl = scoredRows.reduce((sum, row) => sum + row.pnlDollars, 0);
  const winRate = scoredRows.length ? (wins.length / scoredRows.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : 0;
  const averageWin = wins.length ? grossWin / wins.length : 0;
  const averageLoss = losses.length ? losses.reduce((sum, row) => sum + row.pnlDollars, 0) / losses.length : 0;
  const averageTrade = scoredRows.length ? netPnl / scoredRows.length : 0;

  return {
    averageLoss: averageLoss ? formatMobileMoney(averageLoss) : "--",
    averageTrade: scoredRows.length ? formatMobileMoney(averageTrade) : "--",
    averageTradeTone: averageTrade > 0 ? "up" : averageTrade < 0 ? "down" : "neutral",
    averageWin: averageWin ? formatMobileMoney(averageWin) : "--",
    netPnl: scoredRows.length ? formatMobileMoney(netPnl) : "--",
    netPnlTone: netPnl > 0 ? "up" : netPnl < 0 ? "down" : "neutral",
    profitFactor: profitFactor ? formatMobileRatio(profitFactor) : "--",
    winRate: `${winRate.toFixed(0)}%`
  };
}

function readMobileTheme(initialTheme?: MobileTheme): MobileTheme {
  if (typeof window === "undefined") return initialTheme ?? "dark";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : initialTheme ?? "dark";
}

function displaySymbol(row: TradeHistoryRow): string {
  return row.displaySymbol ?? row.symbol.replaceAll("_", "/");
}

function historyRailTone(row: TradeHistoryRow): "model-loss" | "model-win" | "sl" | "tp" {
  const reason = row.exitReasonLabel.toLowerCase();
  if (reason.includes("model") && row.pnlDollars >= 0) return "model-win";
  if (reason.includes("model")) return "model-loss";
  return row.pnlDollars >= 0 ? "tp" : "sl";
}

function latestRowTime(rows: TradeHistoryRow[]): string | undefined {
  return rows
    .flatMap((row) => [row.exitTime, row.entryTime])
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const PACIFIC_DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric"
});

function mobilePacificDateKey(value: string | undefined): string {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  const parts = PACIFIC_DATE_KEY_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function mobileHistoryDayKey(row: TradeHistoryRow): string {
  const time = row.exitTime || row.entryTime;
  return mobilePacificDateKey(time) || "unknown";
}

function mobileHistoryDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map((value) => Number(value));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "Unknown day";
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: PACIFIC_TIME_ZONE,
    weekday: "short",
    year: "numeric"
  });
}

function MobileWorkspaceTabIcon({ tab }: { tab: MobileTradingTab }) {
  if (tab === "history") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          d="M12 5.2A6.8 6.8 0 1 1 5.2 12"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
        <path
          d="M12 8.4V12l2.8 1.8"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M5 7V4.5H7.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (tab === "alerts") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          d="M4 15.5c1.6 0 2.7-.9 3.5-2.8l1.2-2.9 2.6 7.2 2.4-5.1c.6-1.4 1.4-2 2.7-2H20"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (tab === "autotrade") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          d="M5 12h12.6M13.4 7.8 18 12l-4.6 4.2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M5 6.2h4.8M5 17.8h4.8"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.6"
          opacity="0.5"
        />
      </svg>
    );
  }

  if (tab === "sync") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          d="M7.3 7.2a6.7 6.7 0 0 1 9.1-.2L19 9.4M16.7 16.8a6.7 6.7 0 0 1-9.1.2L5 14.6"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M19 5.7v3.7h-3.7M5 18.3v-3.7h3.7"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M6.2 7.2h11.6M6.2 12h11.6M6.2 16.8h7.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <path d="M4.5 4.5h15v15h-15z" fill="none" opacity="0.45" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function MobileSyncPanel({ summary }: { summary?: MobileSyncSummary }) {
  return (
    <section className="mobile-phone-card mobile-phone-card-sync">
      <div className="mobile-phone-card-head">
        <div className="mobile-phone-card-copy">
          <span className="mobile-phone-card-kicker">Runtime</span>
          <h2>{summary?.headline ?? "Sync"}</h2>
        </div>
        <span className="mobile-phone-count-chip">{summary?.sections.length ?? 0}</span>
      </div>

      <p className="mobile-phone-sync-detail">{summary?.detail ?? "Waiting for sync status."}</p>

      <div className="mobile-phone-sync-list">
        {(summary?.sections ?? []).map((section) => (
          <article className={`mobile-phone-sync-section sync-state-${section.state}`} key={section.title}>
            <div className="mobile-phone-sync-section-head">
              <div>
                <strong>{section.title}</strong>
                <span>{section.status}</span>
              </div>
              {section.updatedAt ? (
                <small>
                  <LocalDateTime value={section.updatedAt} fallback="Unknown" />
                </small>
              ) : null}
            </div>
            <div className="mobile-phone-sync-metrics">
              {section.metrics.map((metric) => (
                <span className={metric.tone ? `tone-${metric.tone}` : undefined} key={`${section.title}-${metric.label}`} title={metric.title}>
                  <small>{metric.label}</small>
                  <strong>{metric.value}</strong>
                </span>
              ))}
            </div>
            {section.issues?.length ? (
              <div className="mobile-phone-sync-issues" aria-label={`${section.title} issues`}>
                {section.issues.map((issue) => (
                  <span key={issue}>{issue}</span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function MobileTelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M20.8 4.5 3.8 11c-.9.34-.88 1.05-.16 1.28l4.28 1.34 1.65 5.03c.2.56.49.7.9.32l2.36-2.26 4.2 3.08c.77.42 1.31.2 1.5-.72l2.72-12.83c.28-1.12-.42-1.64-1.45-1.18Z"
        fill="currentColor"
      />
      <path d="m8.35 13.27 8.18-5.13c.4-.24.76-.11.46.16l-6.66 6.02-.25 2.62-1.73-3.67Z" fill="#fff" opacity="0.72" />
    </svg>
  );
}

function MobileDiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M7.1 7.1c3.1-1.1 6.7-1.1 9.8 0 1.2 1.9 1.8 4 1.9 6.3-1.4 1.1-2.9 1.8-4.5 2.1l-.7-1.1c.8-.2 1.5-.5 2.1-.9-2.4 1.1-5 1.1-7.4 0 .7.4 1.4.7 2.1.9l-.7 1.1c-1.6-.3-3.1-1-4.5-2.1.1-2.3.7-4.4 1.9-6.3Z"
        fill="currentColor"
      />
      <path
        d="M9.3 12.6c.63 0 1.14-.57 1.14-1.27s-.51-1.27-1.14-1.27-1.14.57-1.14 1.27.51 1.27 1.14 1.27Zm5.4 0c.63 0 1.14-.57 1.14-1.27s-.51-1.27-1.14-1.27-1.14.57-1.14 1.27.51 1.27 1.14 1.27Z"
        fill="#fff"
        opacity="0.78"
      />
    </svg>
  );
}

function MobileLoadingBar({ label }: { label: string }) {
  return (
    <div className="mobile-phone-loading-bar" role="status" aria-live="polite">
      <span>{label}</span>
    </div>
  );
}

function MobileHistoryStatsStrip({ stats }: { stats: MobileHistoryStats }) {
  return (
    <div className="mobile-phone-history-stats" aria-label="Trade summary">
      <span>
        <small>Win Rate</small>
        <strong>{stats.winRate}</strong>
      </span>
      <span>
        <small>Profit Factor</small>
        <strong>{stats.profitFactor}</strong>
      </span>
      <span>
        <small>Net PnL</small>
        <strong className={stats.netPnlTone}>{stats.netPnl}</strong>
      </span>
      <span>
        <small>Avg Win</small>
        <strong className="up">{stats.averageWin}</strong>
      </span>
      <span>
        <small>Avg Loss</small>
        <strong className="down">{stats.averageLoss}</strong>
      </span>
      <span>
        <small>Avg Trade</small>
        <strong className={stats.averageTradeTone}>{stats.averageTrade}</strong>
      </span>
    </div>
  );
}

function MobileHistoryList({
  emptyTitle,
  kicker,
  onTradeSelect,
  rows,
  title
}: {
  emptyTitle: string;
  kicker: string;
  onTradeSelect: (row: TradeHistoryRow) => void;
  rows: TradeHistoryRow[];
  title: string;
}) {
  const stats = useMemo(() => mobileHistoryStats(rows), [rows]);

  return (
    <section className="mobile-phone-card mobile-phone-card-history">
      <div className="mobile-phone-card-head">
        <div className="mobile-phone-card-copy">
          <span className="mobile-phone-card-kicker">{kicker}</span>
          <h2>{title}</h2>
        </div>
        <span className="mobile-phone-count-chip">{rows.length.toLocaleString("en-US")}</span>
      </div>

      {rows.length === 0 ? (
        <div className="mobile-phone-empty-state">
          <span className="mobile-phone-card-kicker">{kicker}</span>
          <h2>{emptyTitle}</h2>
        </div>
      ) : (
        <>
          <MobileHistoryStatsStrip stats={stats} />
          <div className="mobile-phone-history-list">
            {rows.map((row, index) => {
              const dayKey = mobileHistoryDayKey(row);
              const previousDayKey = index > 0 ? mobileHistoryDayKey(rows[index - 1]!) : "";
              const showDayMarker = dayKey !== previousDayKey;

              return (
                <Fragment key={row.id}>
                  {showDayMarker ? (
                    <div className="mobile-phone-history-day-marker">
                      <span>{mobileHistoryDayLabel(dayKey)}</span>
                    </div>
                  ) : null}
                  <button className="mobile-phone-history-row" onClick={() => onTradeSelect(row)} type="button">
                    <div className="mobile-phone-history-main">
                      <div className="mobile-phone-history-copy">
                        <strong>{displaySymbol(row)}</strong>
                        <span>
                          {row.sideLabel} | {row.exitReasonLabel}
                        </span>
                      </div>
                      <div className="mobile-phone-history-values">
                        <strong className={row.pnlClassName}>
                          {row.isOpen && !row.hasCurrentMark ? "Open" : row.isEstimatedPnl ? `Est. ${row.pnlLabel}` : row.pnlLabel}
                        </strong>
                        <span className="mobile-phone-history-size">{row.sizeLabel}</span>
                      </div>
                    </div>
                    <div className="mobile-phone-history-meta">
                      <span>
                        {row.isOpen ? "Opened\u00a0" : null}
                        <LocalDateTime value={row.isOpen ? row.entryTime : row.exitTime} fallback={row.isOpen ? row.entryTimeLabel : row.exitTimeLabel} />
                      </span>
                      {row.rMultipleLabel !== "--" ? <span>{row.rMultipleLabel}</span> : null}
                      <span>Entry {row.entryPriceLabel}</span>
                      <span>{row.isOpen ? "Mark" : "Exit"} {row.exitPriceLabel}</span>
                    </div>
                    <span className={`mobile-phone-history-rail ${historyRailTone(row)}`} aria-hidden="true" />
                  </button>
                </Fragment>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function MobileMarketModeControl({
  activeMarket,
  hideLoading,
  persistActiveMarket,
  showLoading
}: {
  activeMarket: AutoTradeMarket;
  persistActiveMarket?: (market: AutoTradeMarket) => Promise<void>;
} & MobileLoadingController) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pendingMarket, setPendingMarket] = useState<AutoTradeMarket | null>(null);
  const pendingMarketRef = useRef<AutoTradeMarket | null>(null);
  const canPersistActiveMarket = useAutoTradeAdminMode();

  useEffect(() => {
    if (pendingMarketRef.current === activeMarket) {
      hideLoading();
    }
    pendingMarketRef.current = null;
    setPendingMarket(null);
  }, [activeMarket, hideLoading]);

  function selectMarket(market: AutoTradeMarket) {
    if (market === activeMarket || pendingMarket === market) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("market", market);
    nextParams.delete("strategies");
    nextParams.delete("strategySizes");
    const href = `${pathname}?${nextParams.toString()}`;
    pendingMarketRef.current = market;
    setPendingMarket(market);
    showLoading(`Loading ${market === "futures" ? "Futures" : "Forex"}`, null);

    startTransition(() => {
      if (canPersistActiveMarket && persistActiveMarket) {
        void persistActiveMarket(market).catch((error) => console.error("Failed to save active market", error));
      }
      router.push(href, { scroll: false });
    });
  }

  return (
    <div className="mobile-phone-mode-card">
      <div className="mobile-phone-card-copy">
        <span className="mobile-phone-card-kicker">Market</span>
        <h2>{(pendingMarket ?? activeMarket) === "futures" ? "Futures" : "Forex"}</h2>
      </div>
      <div className="mobile-phone-mode-grid" role="group" aria-label="Switch market">
        {(["forex", "futures"] as const).map((market) => {
          const isActive = (pendingMarket ?? activeMarket) === market;
          return (
            <button
              type="button"
              className={`mobile-phone-mode-button${isActive ? " active" : ""}`}
              disabled={isPending && pendingMarket !== market}
              key={market}
              onClick={() => selectMarket(market)}
            >
              {market === "futures" ? "Futures" : "Forex"}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MobileThemeModeControl({
  initialTheme,
  persistTheme,
  showLoading
}: {
  initialTheme?: MobileTheme;
  persistTheme?: (theme: MobileTheme) => Promise<void>;
} & Pick<MobileLoadingController, "showLoading">) {
  const [theme, setTheme] = useState<MobileTheme>(() => initialTheme ?? "dark");
  const [, startSavingTheme] = useTransition();
  const canPersistTheme = useAutoTradeAdminMode();

  useEffect(() => {
    const currentTheme = readMobileTheme(initialTheme);
    setTheme(currentTheme);
    document.documentElement.dataset.theme = currentTheme;
    document.documentElement.style.colorScheme = currentTheme;
  }, [initialTheme]);

  function selectTheme(nextTheme: MobileTheme) {
    if (nextTheme === theme) return;
    setTheme(nextTheme);
    showLoading(`Switching to ${nextTheme === "light" ? "Light" : "Dark"}`, 760);
    applyMobileTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    if (canPersistTheme && persistTheme) {
      startSavingTheme(() => {
        void persistTheme(nextTheme).catch((error) => console.error("Failed to save theme", error));
      });
    }
  }

  return (
    <div className="mobile-phone-mode-card">
      <div className="mobile-phone-card-copy">
        <span className="mobile-phone-card-kicker">Theme</span>
        <h2>{theme === "light" ? "Light" : "Dark"}</h2>
      </div>
      <div className="mobile-phone-mode-grid" role="group" aria-label="Switch theme">
        {(["dark", "light"] as const).map((mode) => (
          <button
            type="button"
            className={`mobile-phone-mode-button${theme === mode ? " active" : ""}`}
            key={mode}
            onClick={() => selectTheme(mode)}
          >
            {mode === "light" ? "Light" : "Dark"}
          </button>
        ))}
      </div>
    </div>
  );
}

function MobileAccountModeControl({ showLoading }: Pick<MobileLoadingController, "showLoading">) {
  const [accountMode, setAccountMode] = useState<AutoTradeAccountMode | null>(null);
  const [adminCodeInput, setAdminCodeInput] = useState("");
  const [isUnlockingAdmin, setIsUnlockingAdmin] = useState(false);
  const [accountAccessError, setAccountAccessError] = useState("");
  const [adminEntryOpen, setAdminEntryOpen] = useState(false);
  const adminInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function syncAccountMode() {
      setAccountMode(savedAccountMode());
    }

    syncAccountMode();
    window.addEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
    return () => window.removeEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
  }, []);

  useEffect(() => {
    if (!adminEntryOpen) return;
    const frame = window.requestAnimationFrame(() => adminInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [adminEntryOpen]);

  async function selectUserMode() {
    showLoading("Switching to User", 820);
    setAdminEntryOpen(false);
    setAdminCodeInput("");
    setAccountAccessError("");
    await fetch("/api/auto-trading/access-code", { method: "DELETE" }).catch(() => undefined);
    saveAccountMode("User");
  }

  async function unlockAdminMode(code = adminCodeInput) {
    if (code.length < 5 || isUnlockingAdmin) return;

    setIsUnlockingAdmin(true);
    showLoading("Unlocking Admin", 920);
    try {
      const response = await fetch("/api/auto-trading/access-code", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode: code, type: "admin" })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Incorrect code.");
      setAdminEntryOpen(false);
      setAdminCodeInput("");
      setAccountAccessError("");
      saveAccountMode("Admin");
    } catch (error) {
      setAdminCodeInput("");
      setAccountAccessError(error instanceof Error ? error.message : "Incorrect code.");
      window.requestAnimationFrame(() => adminInputRef.current?.focus());
    } finally {
      setIsUnlockingAdmin(false);
    }
  }

  function handleAdminSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void unlockAdminMode();
  }

  return (
    <div className="mobile-phone-mode-card">
      <div className="mobile-phone-card-copy">
        <span className="mobile-phone-card-kicker">Account Mode</span>
        <h2>{accountMode ?? "Choose mode"}</h2>
      </div>
      <div className="mobile-phone-mode-grid" role="group" aria-label="Switch account mode">
        <button
          type="button"
          className={`mobile-phone-mode-button${accountMode === "Admin" ? " active" : ""}`}
          onClick={() => {
            setAdminEntryOpen(true);
            setAccountAccessError("");
          }}
        >
          Admin
        </button>
        <button
          type="button"
          className={`mobile-phone-mode-button${accountMode === "User" ? " active" : ""}`}
          onClick={() => {
            void selectUserMode();
          }}
        >
          User
        </button>
      </div>
      {adminEntryOpen ? (
        <form className="mobile-phone-mode-pin" onSubmit={handleAdminSubmit}>
          <input
            aria-label="Admin code"
            autoComplete="new-password"
            inputMode="numeric"
            maxLength={5}
            onChange={(event) => {
              const nextValue = cleanAccessCode(event.target.value, 5);
              setAdminCodeInput(nextValue);
              setAccountAccessError("");
              if (nextValue.length === 5) void unlockAdminMode(nextValue);
            }}
            pattern="[0-9]*"
            placeholder="Admin code"
            ref={adminInputRef}
            type="password"
            value={adminCodeInput}
          />
          <button type="submit" disabled={adminCodeInput.length < 5 || isUnlockingAdmin}>
            {isUnlockingAdmin ? "Checking..." : "Unlock"}
          </button>
          {accountAccessError ? <small>{accountAccessError}</small> : null}
        </form>
      ) : null}
    </div>
  );
}

function MobileTradeChartModal({
  chartState,
  closeButtonRef,
  modalRef,
  onClose,
  trade
}: {
  chartState: MobileChartState;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  modalRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  trade: TradeHistoryRow;
}) {
  const displayedTrade = withOpenTradeChartMark(trade, chartState.bars);
  const pathStats = tradePathStats(displayedTrade, chartState.bars);
  const durationLabel = tradePathDurationLabel(displayedTrade, chartState.bars);
  return createPortal(
    <div
      className="mobile-trade-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="mobile-trade-modal" role="dialog" aria-modal="true" aria-label={`${displaySymbol(displayedTrade)} trade chart`} ref={modalRef}>
        <div className="mobile-trade-modal-head">
          <div>
            <span>{displayedTrade.sideLabel} / {displayedTrade.exitReasonLabel}</span>
            <strong>{displaySymbol(displayedTrade)}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close trade chart" ref={closeButtonRef}>
            Close
          </button>
        </div>
        <div className="mobile-trade-modal-stats">
          <span>
            <small>{displayedTrade.isEstimatedPnl ? "Estimated PnL" : displayedTrade.isOpen ? "Open PnL" : "PnL"}</small>
            <strong className={displayedTrade.pnlClassName}>{displayedTrade.isOpen && !displayedTrade.hasCurrentMark ? "--" : displayedTrade.pnlLabel}</strong>
          </span>
          <span>
            <small>Size</small>
            <strong>{displayedTrade.sizeLabel}</strong>
          </span>
          <span>
            <small>Entry</small>
            <strong>{displayedTrade.entryPriceLabel}</strong>
          </span>
          <span>
            <small>{displayedTrade.isOpen ? "Mark" : "Exit"}</small>
            <strong>{displayedTrade.exitPriceLabel}</strong>
          </span>
        </div>
        <div className="mobile-trade-modal-levels" aria-label="Trade protection levels">
          <span><small>Take Profit</small><strong className="up">{displayedTrade.targetPriceLabel}</strong></span>
          <span><small>Stop Loss</small><strong className="down">{displayedTrade.stopPriceLabel}</strong></span>
        </div>
        <div className="mobile-trade-modal-path-stats" aria-label="Trade path statistics">
          <span><small>Duration</small><strong>{durationLabel.replace(/\s+bars?/i, "b").replace(" / ", " · ")}</strong></span>
          <span><small>MFE</small><strong className="up">{pathStats.mfe == null ? "--" : formatMobileMoney(pathStats.mfe)}</strong></span>
          <span><small>MAE</small><strong className="down">{pathStats.mae == null ? "--" : formatMobileMoney(-pathStats.mae)}</strong></span>
          <span><small>R</small><strong className={displayedTrade.pnlDollars > 0 ? "up" : displayedTrade.pnlDollars < 0 ? "down" : "neutral"}>{displayedTrade.rMultipleLabel}</strong></span>
        </div>
        {displayedTrade.isEstimatedPnl && displayedTrade.markTime ? (
          <p className="mobile-trade-modal-note mobile-trade-modal-estimate-note">
            Estimated from the latest 1-minute asset price at <LocalDateTime value={displayedTrade.markTime} fallback={displayedTrade.markTime} />.
          </p>
        ) : null}
        {chartState.message ? <p className="mobile-trade-modal-note">{chartState.message}</p> : null}
        <div className="mobile-trade-mini-chart-wrap">
          <BacktestTradeMiniChart bars={chartState.bars} compactTooltip isOpen={Boolean(displayedTrade.isOpen)} status={chartState.status} trade={displayedTrade} />
        </div>
      </section>
    </div>,
    document.body
  );
}

export default function MobileTradingDashboard({
  activeMarket,
  customScaleRange,
  discordChannelLink,
  historyRows,
  initialTheme,
  latestHistoryTradeAt,
  latestLiveAlertAt,
  liveAlertRows,
  marketLabel,
  persistedStrategyEdits,
  persistActiveMarket,
  persistTheme,
  strategies,
  syncSummary,
  telegramGroupLink
}: MobileTradingDashboardProps) {
  const [activeTab, setActiveTab] = useState<MobileTradingTab>("alerts");
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [chartState, setChartState] = useState<MobileChartState>({ status: "idle", bars: [] });
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const loadingTimeoutRef = useRef<number | null>(null);
  const tradeModalRef = useRef<HTMLElement | null>(null);
  const tradeModalCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousTradeFocusRef = useRef<HTMLElement | null>(null);
  const edits = useStrategyEdits(strategies, persistedStrategyEdits);
  const adjustedHistoryRows = useMemo(
    () => adjustTradeHistoryRows(historyRows, strategies, edits, customScaleRange),
    [customScaleRange, edits, historyRows, strategies]
  );
  const adjustedLiveAlertRows = useMemo(() => adjustTradeHistoryRows(liveAlertRows, strategies, edits), [edits, liveAlertRows, strategies]);
  const activeTrade = useMemo(
    () => [...adjustedLiveAlertRows, ...adjustedHistoryRows].find((row) => row.id === activeTradeId) ?? null,
    [activeTradeId, adjustedHistoryRows, adjustedLiveAlertRows]
  );
  const headerTime = useMemo(() => {
    if (activeTab === "alerts") return latestRowTime(adjustedLiveAlertRows) ?? latestLiveAlertAt;
    if (activeTab === "history") return latestRowTime(adjustedHistoryRows) ?? latestHistoryTradeAt;
    return undefined;
  }, [activeTab, adjustedHistoryRows, adjustedLiveAlertRows, latestHistoryTradeAt, latestLiveAlertAt]);
  const headerParts = useLocalHeaderParts(headerTime);
  const tabTitle =
    activeTab === "alerts"
      ? "Live Alerts"
      : activeTab === "sync"
          ? "Sync"
      : activeTab === "autotrade"
        ? "Auto-Trade"
        : activeTab === "settings"
          ? "Settings"
          : "Trade History";

  const hideLoading = useCallback(() => {
    if (loadingTimeoutRef.current !== null) {
      window.clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    setLoadingLabel(null);
  }, []);

  const showLoading = useCallback((label: string, duration: number | null = 760) => {
    if (loadingTimeoutRef.current !== null) {
      window.clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    setLoadingLabel(label);
    if (duration !== null) {
      loadingTimeoutRef.current = window.setTimeout(() => {
        setLoadingLabel(null);
        loadingTimeoutRef.current = null;
      }, duration);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current !== null) window.clearTimeout(loadingTimeoutRef.current);
    };
  }, []);

  function selectTab(tab: MobileTradingTab) {
    if (tab === activeTab) return;
    setActiveTab(tab);
  }

  function openTrade(row: TradeHistoryRow) {
    previousTradeFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActiveTradeId(row.id);
  }

  useEffect(() => {
    if (activeTradeId && !activeTrade) setActiveTradeId(null);
  }, [activeTrade, activeTradeId]);

  useEffect(() => {
    if (!activeTradeId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => tradeModalCloseButtonRef.current?.focus({ preventScroll: true }));
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setActiveTradeId(null);
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          tradeModalRef.current?.querySelectorAll<HTMLElement>(
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
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      const previousFocus = previousTradeFocusRef.current;
      previousTradeFocusRef.current = null;
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      });
    };
  }, [activeTradeId]);

  useEffect(() => {
    if (!activeTrade) {
      setChartState({ status: "idle", bars: [] });
      return undefined;
    }

    const controller = new AbortController();
    const isOpen = Boolean(activeTrade.isOpen);
    const params = new URLSearchParams({
      symbol: activeTrade.symbol,
      market: activeTrade.market ?? "",
      entryIndex: String(activeTrade.entryIndex),
      exitIndex: String(activeTrade.exitIndex),
      entryTime: activeTrade.entryTime,
      exitTime: activeTrade.exitTime,
      timeframe: activeTrade.sourceTimeframe ?? "1m",
      context: String(TRADE_CHART_CONTEXT_CANDLES)
    });
    if (isOpen) params.set("open", "1");

    setChartState({ status: "loading", bars: [] });
    let inFlight = false;
    let quoteInFlight = false;
    const refreshChart = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/trade-chart?${params.toString()}`, {
          cache: isOpen ? "no-store" : "default",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Chart unavailable");
        const payload = (await response.json()) as MobileChartPayload;
        const bars = payload.bars ?? [];
        setChartState((current) =>
          bars.length
            ? { bars, message: payload.error, status: "ready" }
            : current.bars.length
              ? current
              : {
                  bars: [],
                  message: payload.error ?? "Price movement is not available for this trade.",
                  status: "error"
                }
        );
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setChartState((current) =>
            current.bars.length ? current : { status: "error", bars: [], message: "Price movement unavailable." }
          );
        }
      } finally {
        inFlight = false;
      }
    };

    const refreshLiveQuote = async () => {
      if (
        !isOpen ||
        (activeTrade.market && activeTrade.market.toLowerCase() !== "futures") ||
        quoteInFlight ||
        controller.signal.aborted
      ) return;
      quoteInFlight = true;
      try {
        const quoteParams = new URLSearchParams({ market: "futures", symbol: activeTrade.symbol });
        const response = await fetch(`/api/projectx-live-quote?${quoteParams.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) return;
        const payload = (await response.json()) as MobileProjectXLiveQuotePayload;
        const liveBar = payload.bar;
        if (!liveBar) return;
        setChartState((current) =>
          current.bars.length
            ? { ...current, bars: mergeLiveOpenTradeBar(current.bars, liveBar) }
            : current
        );
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) console.warn("ProjectX live quote unavailable", error);
      } finally {
        quoteInFlight = false;
      }
    };

    void refreshChart();
    void refreshLiveQuote();
    const intervalId = isOpen ? window.setInterval(() => void refreshChart(), OPEN_TRADE_CHART_REFRESH_MS) : null;
    const quoteIntervalId = isOpen
      ? window.setInterval(() => void refreshLiveQuote(), PROJECTX_LIVE_QUOTE_REFRESH_MS)
      : null;
    return () => {
      controller.abort();
      if (intervalId !== null) window.clearInterval(intervalId);
      if (quoteIntervalId !== null) window.clearInterval(quoteIntervalId);
    };
  }, [activeTrade]);

  return (
    <main className="terminal mobile-terminal-shell mobile-phone-shell mobileTradingWorkspace">
      <section className="mobile-phone-frame">
        <header className="mobile-phone-header">
          <div className="mobile-phone-brand-row mobile-phone-brand-row-centered">
            <div className="mobile-phone-brand-copy mobile-phone-brand-copy-centered">
              <h1>{tabTitle}</h1>
              {activeTab === "history" || activeTab === "alerts" ? (
                <>
                  <p className="mobile-phone-header-date" suppressHydrationWarning>
                    {headerParts.date}
                  </p>
                  <div className="mobile-phone-header-time-row">
                    <span className="mobile-phone-header-time" suppressHydrationWarning>
                      {headerParts.time || "--"}
                    </span>
                    <span className={`mobile-phone-header-time-badge${activeTab === "alerts" ? " live" : ""}`}>
                      {activeTab === "alerts" ? "Live" : "As Of"}
                    </span>
                  </div>
                </>
              ) : (
                <p className="mobile-phone-header-date">{marketLabel} workspace</p>
              )}
            </div>
          </div>
        </header>

        <div className="mobile-phone-body">
          <div className="mobile-phone-panel" key={activeTab}>
            {activeTab === "history" ? (
              <MobileHistoryList
                emptyTitle="No trades yet"
                kicker="Trade History"
                onTradeSelect={openTrade}
                rows={adjustedHistoryRows}
                title="History"
              />
            ) : activeTab === "alerts" ? (
              <MobileHistoryList
                emptyTitle="No live alerts yet"
                kicker="Live Alerts"
                onTradeSelect={openTrade}
                rows={adjustedLiveAlertRows}
                title="Live Alerts"
              />
            ) : activeTab === "sync" ? (
              <MobileSyncPanel summary={syncSummary} />
            ) : activeTab === "autotrade" ? (
              <section className="mobile-phone-card mobile-phone-card-autotrade">
                <div className="mobile-phone-social-stack mobile-phone-autotrade-stack">
                  <AutoTradingConnectionPanel market={activeMarket} />
                </div>
              </section>
            ) : (
              <section className="mobile-phone-card mobile-phone-card-settings">
                <div className="mobile-phone-account-card">
                  <div className="mobile-phone-account-avatar">TB</div>
                  <div className="mobile-phone-account-copy">
                    <span>Signed In</span>
                    <strong>Trading Bot</strong>
                    <small>{marketLabel}</small>
                  </div>
                </div>

                <div className="mobile-phone-action-list">
                  <MobileAccountModeControl showLoading={showLoading} />
                  <MobileMarketModeControl
                    activeMarket={activeMarket}
                    hideLoading={hideLoading}
                    persistActiveMarket={persistActiveMarket}
                    showLoading={showLoading}
                  />
                  <MobileThemeModeControl initialTheme={initialTheme} persistTheme={persistTheme} showLoading={showLoading} />
                  {telegramGroupLink ? (
                    <a className="mobile-phone-action-btn mobile-phone-telegram-link" href={telegramGroupLink} rel="noreferrer" target="_blank">
                      <span className="mobile-phone-action-icon"><MobileTelegramIcon /></span>
                      <span>
                        <strong>Telegram Group</strong>
                        <small>Open alert channel</small>
                      </span>
                    </a>
                  ) : null}
                  {discordChannelLink ? (
                    <a className="mobile-phone-action-btn mobile-phone-discord-link" href={discordChannelLink} rel="noreferrer" target="_blank">
                      <span className="mobile-phone-action-icon"><MobileDiscordIcon /></span>
                      <span>
                        <strong>Discord Channel</strong>
                        <small>Open alert channel</small>
                      </span>
                    </a>
                  ) : null}
                </div>
              </section>
            )}
          </div>
        </div>

        <nav className="mobile-phone-tabbar" aria-label="Mobile workspace tabs">
          {mobileTabs.map((tab) => (
            <button
              aria-pressed={activeTab === tab.id}
              className={`mobile-phone-tab${activeTab === tab.id ? " active" : ""}`}
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              type="button"
            >
              <span className="mobile-phone-tab-icon">
                <MobileWorkspaceTabIcon tab={tab.id} />
              </span>
              <span className="mobile-phone-tab-label">{tab.label}</span>
            </button>
          ))}
        </nav>
        {loadingLabel ? <MobileLoadingBar label={loadingLabel} /> : null}
      </section>
      {activeTrade ? (
        <MobileTradeChartModal
          chartState={chartState}
          closeButtonRef={tradeModalCloseButtonRef}
          modalRef={tradeModalRef}
          onClose={() => setActiveTradeId(null)}
          trade={activeTrade}
        />
      ) : null}
    </main>
  );
}
