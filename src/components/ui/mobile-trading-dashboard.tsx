"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import AutoTradingConnectionPanel from "@/components/auto-trading/auto-trading-connection-panel";
import {
  AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT,
  cleanAccessCode,
  savedAccountMode,
  saveAccountMode,
  type AutoTradeAccountMode
} from "@/components/auto-trading/auto-trade-account-mode";
import { type TradeHistoryRow } from "@/components/trades/trade-history";
import ThemeToggle from "@/components/ui/theme-toggle";
import { type AutoTradeMarket } from "@/lib/auto-trade-platforms";

type MobileTradingTab = "history" | "alerts" | "autotrade" | "settings";

type MobileTradingDashboardProps = {
  activeMarket: AutoTradeMarket;
  historyRows: TradeHistoryRow[];
  initialTheme?: "dark" | "light";
  latestHistoryTradeAt?: string;
  latestLiveAlertAt?: string;
  liveAlertRows: TradeHistoryRow[];
  marketLabel: string;
  telegramGroupLink?: string | null;
};

const mobileTabs: Array<{ id: MobileTradingTab; label: string }> = [
  { id: "history", label: "History" },
  { id: "alerts", label: "Live Alerts" },
  { id: "autotrade", label: "Auto-Trade" },
  { id: "settings", label: "Settings" }
];

function formatDateLabel(value?: string): string {
  if (!value) return "No activity yet";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "No activity yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(parsed));
}

function formatTimeLabel(value?: string): string {
  if (!value) return "--";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "--";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(parsed));
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
    .map((row) => row.entryTime)
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
  rows,
  title
}: {
  emptyTitle: string;
  kicker: string;
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
            <div className="mobile-phone-history-row" key={row.id}>
              <div className="mobile-phone-history-main">
                <div className="mobile-phone-history-copy">
                  <strong>{displaySymbol(row)}</strong>
                  <span>
                    {row.sideLabel} | {row.exitReasonLabel}
                  </span>
                </div>
                <div className="mobile-phone-history-values">
                  <strong className={row.pnlClassName}>{row.pnlLabel}</strong>
                  <span className={row.pnlClassName}>{row.rMultipleLabel}</span>
                </div>
              </div>
              <div className="mobile-phone-history-meta">
                <span>{row.exitTimeLabel}</span>
                <span>Entry {row.entryPriceLabel}</span>
                <span>Exit {row.exitPriceLabel}</span>
              </div>
              <span className={`mobile-phone-history-rail ${historyRailTone(row)}`} aria-hidden="true" />
            </div>
          ))}
        </div>
      )}
    </section>
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

export default function MobileTradingDashboard({
  activeMarket,
  historyRows,
  initialTheme,
  latestHistoryTradeAt,
  latestLiveAlertAt,
  liveAlertRows,
  marketLabel,
  telegramGroupLink
}: MobileTradingDashboardProps) {
  const [activeTab, setActiveTab] = useState<MobileTradingTab>("history");
  const headerTime = useMemo(() => {
    if (activeTab === "alerts") return latestLiveAlertAt ?? latestRowTime(liveAlertRows);
    if (activeTab === "history") return latestHistoryTradeAt ?? latestRowTime(historyRows);
    return undefined;
  }, [activeTab, historyRows, latestHistoryTradeAt, latestLiveAlertAt, liveAlertRows]);
  const tabTitle =
    activeTab === "alerts"
      ? "Live Alerts"
      : activeTab === "autotrade"
        ? "Auto-Trade"
        : activeTab === "settings"
          ? "Settings"
          : "Trade History";

  return (
    <main className="terminal mobile-terminal-shell mobile-phone-shell mobileTradingWorkspace">
      <section className="mobile-phone-frame">
        <header className="mobile-phone-header">
          <div className="mobile-phone-brand-row mobile-phone-brand-row-centered">
            <div className="mobile-phone-brand-copy mobile-phone-brand-copy-centered">
              <h1>{tabTitle}</h1>
              {activeTab === "history" || activeTab === "alerts" ? (
                <>
                  <p className="mobile-phone-header-date">{formatDateLabel(headerTime)}</p>
                  <div className="mobile-phone-header-time-row">
                    <span className="mobile-phone-header-time">{formatTimeLabel(headerTime)}</span>
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
            <MobileHistoryList emptyTitle="No trades yet" kicker="Trade History" rows={historyRows} title="History" />
          ) : activeTab === "alerts" ? (
            <MobileHistoryList emptyTitle="No live alerts yet" kicker="Live Alerts" rows={liveAlertRows} title="Live Alerts" />
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
                <div className="mobile-phone-toggle-row mobile-phone-theme-row">
                  <div className="mobile-phone-toggle-copy">
                    <strong>Theme</strong>
                    <small>Switch between dark and light mode on this device.</small>
                  </div>
                  <ThemeToggle initialTheme={initialTheme} />
                </div>
                <Link className="mobile-phone-action-btn" href="/research">
                  <strong>Research</strong>
                  <span>Open strategy research workspace</span>
                </Link>
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
    </main>
  );
}
