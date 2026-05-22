"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { BacktestTradeMiniChart, type TradeHistoryRow } from "@/components/trades/trade-history";
import LocalDateTime, { formatLocalDateTimeParts } from "@/components/ui/local-date-time";
import { type AutoTradeMarket } from "@/lib/auto-trade-platforms";
import { type TradeChartBar, type TradeChartTimeframe } from "@/components/trades/trade-price-chart";

type MobileTradingTab = "history" | "alerts" | "autotrade" | "settings";

type MobileTradingDashboardProps = {
  activeMarket: AutoTradeMarket;
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
  telegramGroupLink?: string | null;
};

type MobileTheme = "dark" | "light";

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

const THEME_STORAGE_KEY = "trading-bot-theme";
const LEGACY_THEME_STORAGE_KEY = "signal-console-theme";
const TRADE_CHART_CONTEXT_CANDLES = 240;

const mobileTabs: Array<{ id: MobileTradingTab; label: string }> = [
  { id: "alerts", label: "Live Alerts" },
  { id: "history", label: "History" },
  { id: "autotrade", label: "Auto-Trade" },
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
        <div className="mobile-phone-history-list">
          {rows.map((row) => (
            <button className="mobile-phone-history-row" key={row.id} onClick={() => onTradeSelect(row)} type="button">
              <div className="mobile-phone-history-main">
                <div className="mobile-phone-history-copy">
                  <strong>{displaySymbol(row)}</strong>
                  <span>
                    {row.sideLabel} | {row.exitReasonLabel}
                  </span>
                </div>
                <div className="mobile-phone-history-values">
                  <strong className={row.pnlClassName}>{row.pnlLabel}</strong>
                  <span className="mobile-phone-history-size">{row.sizeLabel}</span>
                </div>
              </div>
              <div className="mobile-phone-history-meta">
                <span>
                  <LocalDateTime value={row.exitTime} fallback={row.exitTimeLabel} />
                </span>
                <span>{row.rMultipleLabel}</span>
                <span>Entry {row.entryPriceLabel}</span>
                <span>Exit {row.exitPriceLabel}</span>
              </div>
              <span className={`mobile-phone-history-rail ${historyRailTone(row)}`} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function MobileMarketModeControl({
  activeMarket,
  persistActiveMarket
}: {
  activeMarket: AutoTradeMarket;
  persistActiveMarket?: (market: AutoTradeMarket) => Promise<void>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pendingMarket, setPendingMarket] = useState<AutoTradeMarket | null>(null);
  const canPersistActiveMarket = useAutoTradeAdminMode();

  useEffect(() => {
    setPendingMarket(null);
  }, [activeMarket]);

  function selectMarket(market: AutoTradeMarket) {
    if (market === activeMarket || pendingMarket === market) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("market", market);
    const href = `${pathname}?${nextParams.toString()}`;
    setPendingMarket(market);

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
  persistTheme
}: {
  initialTheme?: MobileTheme;
  persistTheme?: (theme: MobileTheme) => Promise<void>;
}) {
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

function MobileAccountModeControl() {
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
    setAdminEntryOpen(false);
    setAdminCodeInput("");
    setAccountAccessError("");
    await fetch("/api/auto-trading/access-code", { method: "DELETE" }).catch(() => undefined);
    saveAccountMode("User");
  }

  async function unlockAdminMode(code = adminCodeInput) {
    if (code.length < 5 || isUnlockingAdmin) return;

    setIsUnlockingAdmin(true);
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
  onClose,
  trade
}: {
  chartState: MobileChartState;
  onClose: () => void;
  trade: TradeHistoryRow;
}) {
  return createPortal(
    <div
      className="mobile-trade-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="mobile-trade-modal" role="dialog" aria-modal="true" aria-label={`${displaySymbol(trade)} trade chart`}>
        <div className="mobile-trade-modal-head">
          <div>
            <span>{trade.sideLabel} / {trade.exitReasonLabel}</span>
            <strong>{displaySymbol(trade)}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close trade chart">
            Close
          </button>
        </div>
        <div className="mobile-trade-modal-stats">
          <span>
            <small>PnL</small>
            <strong className={trade.pnlClassName}>{trade.pnlLabel}</strong>
          </span>
          <span>
            <small>Size</small>
            <strong>{trade.sizeLabel}</strong>
          </span>
          <span>
            <small>Entry</small>
            <strong>{trade.entryPriceLabel}</strong>
          </span>
          <span>
            <small>Exit</small>
            <strong>{trade.exitPriceLabel}</strong>
          </span>
        </div>
        {chartState.message ? <p className="mobile-trade-modal-note">{chartState.message}</p> : null}
        <div className="mobile-trade-mini-chart-wrap">
          <BacktestTradeMiniChart bars={chartState.bars} isOpen status={chartState.status} trade={trade} />
        </div>
      </section>
    </div>,
    document.body
  );
}

export default function MobileTradingDashboard({
  activeMarket,
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
  telegramGroupLink
}: MobileTradingDashboardProps) {
  const [activeTab, setActiveTab] = useState<MobileTradingTab>("alerts");
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [chartState, setChartState] = useState<MobileChartState>({ status: "idle", bars: [] });
  const edits = useStrategyEdits(strategies, persistedStrategyEdits);
  const adjustedHistoryRows = useMemo(() => adjustTradeHistoryRows(historyRows, strategies, edits), [edits, historyRows, strategies]);
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
      : activeTab === "autotrade"
        ? "Auto-Trade"
        : activeTab === "settings"
          ? "Settings"
          : "Trade History";

  useEffect(() => {
    if (activeTradeId && !activeTrade) setActiveTradeId(null);
  }, [activeTrade, activeTradeId]);

  useEffect(() => {
    if (!activeTradeId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveTradeId(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeTradeId]);

  useEffect(() => {
    if (!activeTrade) {
      setChartState({ status: "idle", bars: [] });
      return undefined;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      symbol: activeTrade.symbol,
      market: activeTrade.market ?? "",
      entryIndex: String(activeTrade.entryIndex),
      exitIndex: String(activeTrade.exitIndex),
      entryTime: activeTrade.entryTime,
      exitTime: activeTrade.exitTime,
      timeframe: activeTrade.sourceTimeframe ?? "15m",
      context: String(TRADE_CHART_CONTEXT_CANDLES)
    });

    setChartState({ status: "loading", bars: [] });
    fetch(`/api/trade-chart?${params.toString()}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<MobileChartPayload>) : Promise.reject(new Error("Chart unavailable"))))
      .then((payload) => {
        setChartState({
          bars: payload.bars ?? [],
          message: payload.error,
          status: "ready"
        });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setChartState({ status: "error", bars: [], message: "Price movement unavailable." });
      });

    return () => controller.abort();
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
          {activeTab === "history" ? (
            <MobileHistoryList
              emptyTitle="No trades yet"
              kicker="Trade History"
              onTradeSelect={(row) => setActiveTradeId(row.id)}
              rows={adjustedHistoryRows}
              title="History"
            />
          ) : activeTab === "alerts" ? (
            <MobileHistoryList
              emptyTitle="No live alerts yet"
              kicker="Live Alerts"
              onTradeSelect={(row) => setActiveTradeId(row.id)}
              rows={adjustedLiveAlertRows}
              title="Live Alerts"
            />
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
                <MobileAccountModeControl />
                <MobileMarketModeControl activeMarket={activeMarket} persistActiveMarket={persistActiveMarket} />
                <MobileThemeModeControl initialTheme={initialTheme} persistTheme={persistTheme} />
                {telegramGroupLink ? (
                  <a className="mobile-phone-action-btn" href={telegramGroupLink} rel="noreferrer" target="_blank">
                    <strong>Telegram Group</strong>
                    <span>Open alert channel</span>
                  </a>
                ) : null}
              </div>
            </section>
          )}
        </div>

        <nav className="mobile-phone-tabbar" aria-label="Mobile workspace tabs">
          {mobileTabs.map((tab) => (
            <button
              aria-pressed={activeTab === tab.id}
              className={`mobile-phone-tab${activeTab === tab.id ? " active" : ""}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <span className="mobile-phone-tab-icon">
                <MobileWorkspaceTabIcon tab={tab.id} />
              </span>
              <span className="mobile-phone-tab-label">{tab.label}</span>
            </button>
          ))}
        </nav>
      </section>
      {activeTrade ? <MobileTradeChartModal chartState={chartState} onClose={() => setActiveTradeId(null)} trade={activeTrade} /> : null}
    </main>
  );
}
