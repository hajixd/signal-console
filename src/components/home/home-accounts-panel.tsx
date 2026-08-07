"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppSession } from "@/components/auth/app-session-provider";
import type { TradeHistoryRow } from "@/components/trades/trade-history";

type HomeRange = "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";

type ConnectedAccount = {
  balance?: number;
  detail: string;
  id: string;
  name: string;
  paused: boolean;
  platform: string;
};

type ProjectXPayload = {
  connections?: Array<{
    accounts?: Array<{ balance?: number; canTrade?: boolean; id: number; name: string }>;
    displayName?: string;
    id: string;
    pausedAccountIds?: number[];
    status?: string;
  }>;
};

type GenericPayload = {
  connections?: Array<{
    accountBalance?: number;
    accountId?: string;
    accountName?: string;
    firmLabel?: string;
    id: string;
    paused?: boolean;
    providerLabel?: string;
  }>;
};

const HOME_RANGES: HomeRange[] = ["1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"];

function executionTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  return new Date(time).toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  });
}

function money(value: number, decimals = 2): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  })}`;
}

function rangeStart(range: HomeRange, anchor: number): number | null {
  if (range === "ALL") return null;
  if (range === "YTD") return new Date(new Date(anchor).getFullYear(), 0, 1).getTime();
  const days = range === "1D" ? 1 : range === "1W" ? 7 : range === "1M" ? 31 : range === "3M" ? 92 : 365;
  return anchor - days * 24 * 60 * 60 * 1000;
}

export default function HomeAccountsPanel({ compact = false, executionRows = [] }: { compact?: boolean; executionRows?: TradeHistoryRow[] }) {
  const { onlineUsers, user } = useAppSession();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [range, setRange] = useState<HomeRange>("ALL");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/topstep/connection", { cache: "no-store" }).then((response) => response.json()).catch(() => ({})) as Promise<ProjectXPayload>,
      fetch("/api/auto-trading/connections", { cache: "no-store" }).then((response) => response.json()).catch(() => ({})) as Promise<GenericPayload>
    ]).then(([projectX, generic]) => {
      if (cancelled) return;
      const projectXAccounts = (projectX.connections ?? []).flatMap((folder) => {
        const paused = new Set(folder.pausedAccountIds ?? []);
        return (folder.accounts ?? []).map((account) => ({
          balance: account.balance,
          detail: folder.displayName ?? "ProjectX folder",
          id: `${folder.id}:${account.id}`,
          name: account.name || String(account.id),
          paused: paused.has(account.id) || account.canTrade === false,
          platform: "TopstepX"
        }));
      });
      const genericAccounts = (generic.connections ?? []).map((account) => ({
        balance: account.accountBalance,
        detail: [account.firmLabel, account.accountId].filter(Boolean).join(" · ") || "Connected account",
        id: account.id,
        name: account.accountName ?? account.providerLabel ?? account.id,
        paused: account.paused === true,
        platform: account.providerLabel ?? account.id.toUpperCase()
      }));
      setAccounts([...projectXAccounts, ...genericAccounts]);
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const runningAccounts = useMemo(() => accounts.filter((account) => !account.paused).length, [accounts]);
  const totalAccountValue = useMemo(
    () => accounts.reduce((total, account) => total + (Number.isFinite(account.balance) ? account.balance ?? 0 : 0), 0),
    [accounts]
  );
  const allSuccessfulExecutions = useMemo(
    () => executionRows.filter((row) => row.executionStatus === "placed"),
    [executionRows]
  );
  const successfulExecutions = useMemo(
    () => [...allSuccessfulExecutions]
      .sort((left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime))
      .slice(0, compact ? 6 : 10),
    [allSuccessfulExecutions, compact]
  );
  const closedExecutions = useMemo(
    () => allSuccessfulExecutions
      .filter((row) => row.exitReasonLabel !== "Still Open" && Number.isFinite(row.pnlDollars))
      .sort((left, right) => Date.parse(left.entryTime) - Date.parse(right.entryTime)),
    [allSuccessfulExecutions]
  );
  const allTimeNet = useMemo(() => closedExecutions.reduce((total, row) => total + row.pnlDollars, 0), [closedExecutions]);
  const chart = useMemo(() => {
    const datedTrades = closedExecutions.filter((row) => Number.isFinite(Date.parse(row.entryTime)));
    const anchor = datedTrades.length ? Date.parse(datedTrades[datedTrades.length - 1]!.entryTime) : Date.now();
    const start = rangeStart(range, anchor);
    const visible = start === null ? datedTrades : datedTrades.filter((row) => Date.parse(row.entryTime) >= start);
    const change = visible.reduce((total, row) => total + row.pnlDollars, 0);
    const currentValue = totalAccountValue || allTimeNet;
    const startValue = currentValue - change;
    const values = [startValue];
    visible.forEach((row) => values.push(values[values.length - 1]! + row.pnlDollars));
    if (values.length === 1) values.push(startValue);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const span = Math.max(1, maximum - minimum);
    const points = values.map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 1000;
      const y = 235 - ((value - minimum) / span) * 205;
      return { value, x, y };
    });
    return {
      change,
      currentValue,
      path: points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "),
      percent: Math.abs(startValue) > 0.01 ? (change / Math.abs(startValue)) * 100 : 0,
      positive: change >= 0
    };
  }, [allTimeNet, closedExecutions, range, totalAccountValue]);
  const executionStats = useMemo(() => {
    const wins = closedExecutions.filter((row) => row.pnlDollars > 0).length;
    return {
      closed: closedExecutions.length,
      net: allTimeNet,
      winRate: closedExecutions.length ? (wins / closedExecutions.length) * 100 : 0
    };
  }, [allTimeNet, closedExecutions]);
  const visibleOnlineUsers = useMemo(() => {
    if (onlineUsers.some((onlineUser) => onlineUser.id === user.id)) return onlineUsers;
    return [{ area: "Home", id: user.id, lastSeen: new Date().toISOString(), role: user.role, username: user.username }, ...onlineUsers];
  }, [onlineUsers, user]);

  return (
    <section className={`homeAccountsPanel robinhoodHome${compact ? " is-compact" : ""}`}>
      <div className="robinhoodHomeGrid">
        <section className="homePortfolioOverview" aria-label="Live portfolio performance">
          <header className="homePortfolioHeading">
            <div>
              <span>Live portfolio</span>
              <h2>{isLoading ? "—" : money(chart.currentValue)}</h2>
              <p className={chart.positive ? "up" : "down"}>
                {chart.positive ? "▲" : "▼"} {money(Math.abs(chart.change))} ({Math.abs(chart.percent).toFixed(2)}%) <small>{range === "ALL" ? "all time" : range}</small>
              </p>
            </div>
            <div className="homePortfolioPulse"><i />{runningAccounts} trading</div>
          </header>
          <div className={`homeEquityChart${chart.positive ? " is-positive" : " is-negative"}`}>
            <svg aria-label={`${range} execution equity curve`} preserveAspectRatio="none" role="img" viewBox="0 0 1000 260">
              <line x1="0" x2="1000" y1="235" y2="235" />
              <path d={chart.path} fill="none" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="homeRangePicker" role="group" aria-label="Performance range">
            {HOME_RANGES.map((option) => (
              <button aria-pressed={range === option} className={range === option ? "is-active" : ""} key={option} onClick={() => setRange(option)} type="button">{option}</button>
            ))}
          </div>
          <div className="homeBuyingPower">
            <span>{totalAccountValue ? "Connected account value" : "Realized P&L"}</span>
            <strong>{money(totalAccountValue || allTimeNet)}</strong>
          </div>
        </section>

        <aside className="homePortfolioRail">
          <article className="homeAccountList">
            <header><div><span>Accounts</span><h3>Connected</h3></div><a href="#autotrade">Manage</a></header>
            {isLoading ? <p className="homeEmptyState">Loading connected accounts…</p> : accounts.length ? (
              <div className="homeRows">
                {accounts.map((account) => (
                  <div className="homeAccountRow" key={account.id}>
                    <span className="homePlatformMark">{account.platform.slice(0, 2).toUpperCase()}</span>
                    <div><strong>{account.name}</strong><small>{account.platform} · {account.detail}</small></div>
                    <div className="homeAccountValue">
                      {Number.isFinite(account.balance) ? <strong>{money(account.balance ?? 0, 0)}</strong> : null}
                      <span className={`homeStatus${account.paused ? " is-paused" : ""}`}><i />{account.paused ? "Paused" : "Ready"}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="homeEmptyState">No accounts yet. Open Auto-Trade to connect one.</p>}
          </article>
          <article className="homeOnlineList">
            <header><div><span>Presence</span><h3>Who’s online</h3></div><strong>{visibleOnlineUsers.length}</strong></header>
            <div className="codenamesOnlineList">
              <div className="codenamesOnlineSection">Online ({visibleOnlineUsers.length})</div>
              {visibleOnlineUsers.map((onlineUser) => (
                <div className={`codenamesOnlineRow${onlineUser.id === user.id ? " is-you" : ""}`} key={onlineUser.id}>
                  <i className="codenamesOnlineDot" />
                  <strong>{onlineUser.username}</strong>
                  <span className="codenamesOnlineRole">{onlineUser.role}</span>
                  <small>{onlineUser.area || "Active"}</small>
                </div>
              ))}
            </div>
          </article>
        </aside>
      </div>

      <article className="homeExecutionHistory">
        <header>
          <div><span>Trade history</span><h3>Recent executions</h3></div>
          <div className="homeExecutionStats" aria-label="Successful execution summary">
            <span><small>Executed</small><strong>{allSuccessfulExecutions.length}</strong></span>
            <span><small>Closed</small><strong>{executionStats.closed}</strong></span>
            <span><small>Win rate</small><strong>{executionStats.closed ? `${executionStats.winRate.toFixed(1)}%` : "—"}</strong></span>
            <span><small>Net PnL</small><strong className={executionStats.net > 0 ? "up" : executionStats.net < 0 ? "down" : ""}>{executionStats.closed ? `${executionStats.net >= 0 ? "+" : "-"}$${Math.abs(executionStats.net).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</strong></span>
          </div>
        </header>
        {successfulExecutions.length ? (
          <div className="homeExecutionRows">
            {successfulExecutions.map((trade) => (
              <div className="homeExecutionRow" key={trade.id}>
                <div className="homeExecutionInstrument">
                  <span className={`homeExecutionSide ${trade.sideClassName}`}>{trade.sideLabel}</span>
                  <div><strong>{trade.displaySymbol ?? trade.symbol}</strong><small>{trade.modelName}</small></div>
                </div>
                <div className="homeExecutionMeta"><span>Filled</span><strong>{executionTime(trade.entryTime)}</strong></div>
                <div className="homeExecutionMeta"><span>Size</span><strong>{trade.sizeLabel}</strong></div>
                <div className="homeExecutionMeta"><span>Accounts</span><strong>{trade.executionAccountCount ?? 1}{trade.executionProviderLabel ? ` · ${trade.executionProviderLabel}` : ""}</strong></div>
                <span className="homeExecutedBadge"><i />Executed</span>
                <strong className={`homeExecutionPnl ${trade.pnlClassName}`}>{trade.exitReasonLabel === "Still Open" ? "Open" : trade.pnlLabel}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="homeEmptyState">No successfully executed trades yet. Failed, skipped, disabled, and dry-run alerts are hidden here.</p>
        )}
      </article>
    </section>
  );
}
