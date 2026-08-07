"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppSession } from "@/components/auth/app-session-provider";
import type { TradeHistoryRow } from "@/components/trades/trade-history";

type HomeRange = "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";
type ExecutionFilter = "all" | "open" | "closed";

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

type WorkspaceAccount = {
  createdAt: string;
  id: string;
  role: "admin" | "user";
  username: string;
};

type WorkspaceAccountsPayload = {
  accounts?: WorkspaceAccount[];
};

const HOME_RANGES: HomeRange[] = ["1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"];
const HOME_ACCOUNTS_CACHE_MS = 5_000;
let homeAccountsCache: { accounts: ConnectedAccount[]; loadedAt: number } | null = null;
let homeAccountsRequest: Promise<ConnectedAccount[]> | null = null;
let workspaceAccountsCache: { accounts: WorkspaceAccount[]; loadedAt: number } | null = null;

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

async function loadConnectedAccounts(): Promise<ConnectedAccount[]> {
  if (homeAccountsCache && Date.now() - homeAccountsCache.loadedAt < HOME_ACCOUNTS_CACHE_MS) {
    return homeAccountsCache.accounts;
  }
  if (homeAccountsRequest) return homeAccountsRequest;

  homeAccountsRequest = Promise.all([
    fetch("/api/topstep/connection", { cache: "no-store" }).then((response) => response.json()).catch(() => ({})) as Promise<ProjectXPayload>,
    fetch("/api/auto-trading/connections", { cache: "no-store" }).then((response) => response.json()).catch(() => ({})) as Promise<GenericPayload>
  ]).then(([projectX, generic]) => {
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
    const accounts = [...projectXAccounts, ...genericAccounts];
    homeAccountsCache = { accounts, loadedAt: Date.now() };
    return accounts;
  }).finally(() => {
    homeAccountsRequest = null;
  });

  return homeAccountsRequest;
}

async function loadWorkspaceAccounts(): Promise<WorkspaceAccount[]> {
  if (workspaceAccountsCache && Date.now() - workspaceAccountsCache.loadedAt < 30_000) {
    return workspaceAccountsCache.accounts;
  }
  const response = await fetch("/api/auth/accounts", { cache: "no-store", credentials: "same-origin" }).catch(() => null);
  if (!response?.ok) return [];
  const payload = (await response.json().catch(() => ({}))) as WorkspaceAccountsPayload;
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  workspaceAccountsCache = { accounts, loadedAt: Date.now() };
  return accounts;
}

export default function HomeAccountsPanel({
  compact = false,
  executionRows = [],
  onManageAccounts
}: {
  compact?: boolean;
  executionRows?: TradeHistoryRow[];
  onManageAccounts?: () => void;
}) {
  const { onlineUsers, user } = useAppSession();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [workspaceAccounts, setWorkspaceAccounts] = useState<WorkspaceAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [range, setRange] = useState<HomeRange>("ALL");
  const [executionFilter, setExecutionFilter] = useState<ExecutionFilter>("all");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadConnectedAccounts(), loadWorkspaceAccounts()]).then(([nextAccounts, nextWorkspaceAccounts]) => {
      if (cancelled) return;
      setAccounts(nextAccounts);
      setWorkspaceAccounts(nextWorkspaceAccounts);
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
    () => allSuccessfulExecutions
      .filter((row) => executionFilter === "all"
        || (executionFilter === "open" ? row.exitReasonLabel === "Still Open" : row.exitReasonLabel !== "Still Open"))
      .sort((left, right) => Date.parse(right.entryTime) - Date.parse(left.entryTime))
      .slice(0, compact ? 6 : 10),
    [allSuccessfulExecutions, compact, executionFilter]
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
      const x = values.length === 1 ? 30 : 30 + (index / (values.length - 1)) * 940;
      const y = 228 - ((value - minimum) / span) * 190;
      return { value, x, y };
    });
    const path = points.slice(1).reduce((result, point, index) => {
      const previous = points[index]!;
      const midpoint = (previous.x + point.x) / 2;
      return `${result} L${midpoint.toFixed(1)},${previous.y.toFixed(1)} L${midpoint.toFixed(1)},${point.y.toFixed(1)} L${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    }, `M${points[0]!.x.toFixed(1)},${points[0]!.y.toFixed(1)}`);
    const lastPoint = points[points.length - 1]!;
    return {
      areaPath: `${path} L${lastPoint.x.toFixed(1)},244 L${points[0]!.x.toFixed(1)},244 Z`,
      baselineY: points[0]!.y,
      change,
      currentValue,
      endpoint: lastPoint,
      path,
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
  const people = useMemo(() => {
    const onlineById = new Map(visibleOnlineUsers.map((onlineUser) => [onlineUser.id, onlineUser]));
    const known = workspaceAccounts.length
      ? workspaceAccounts
      : visibleOnlineUsers.map((onlineUser) => ({ createdAt: "", ...onlineUser }));
    if (!known.some((account) => account.id === user.id)) known.unshift(user);
    return known
      .map((account) => ({ ...account, presence: onlineById.get(account.id) }))
      .sort((left, right) => {
        if (left.id === user.id) return -1;
        if (right.id === user.id) return 1;
        if (Boolean(left.presence) !== Boolean(right.presence)) return left.presence ? -1 : 1;
        return left.username.localeCompare(right.username);
      });
  }, [user, visibleOnlineUsers, workspaceAccounts]);
  const friendAccounts = useMemo(() => people.filter((account) => account.id !== user.id), [people, user.id]);
  const onlineFriendCount = useMemo(() => friendAccounts.filter((account) => account.presence).length, [friendAccounts]);

  return (
    <section className={`homeAccountsPanel robinhoodHome${compact ? " is-compact" : ""}`}>
      <div className="robinhoodHomeGrid">
        <section aria-busy={isLoading} className="homePortfolioOverview" aria-label="Live portfolio performance">
          <header className="homePortfolioHeading">
            <div>
              <span>Live portfolio</span>
              <h2 className={isLoading ? "is-loading" : undefined}>{isLoading ? "Loading" : money(chart.currentValue)}</h2>
              <p className={chart.positive ? "up" : "down"}>
                {chart.positive ? "▲" : "▼"} {money(Math.abs(chart.change))} ({Math.abs(chart.percent).toFixed(2)}%) <small>{range === "ALL" ? "all time" : range}</small>
              </p>
            </div>
            <div className="homePortfolioPulse"><i />{runningAccounts} trading</div>
          </header>
          <div className={`homeEquityChart${chart.positive ? " is-positive" : " is-negative"}${isLoading ? " is-loading" : ""}`}>
            <svg aria-label={`${range} execution equity curve`} key={range} preserveAspectRatio="none" role="img" viewBox="0 0 1000 260">
              <defs>
                <linearGradient id={`home-equity-fill-${range}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={chart.positive ? "#00c805" : "#ff6b6b"} stopOpacity="0.14" />
                  <stop offset="100%" stopColor={chart.positive ? "#00c805" : "#ff6b6b"} stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="30" x2="970" y1={chart.baselineY} y2={chart.baselineY} />
              <path className="homeEquityArea" d={chart.areaPath} fill={`url(#home-equity-fill-${range})`} />
              <path className="homeEquityLine" d={chart.path} fill="none" pathLength="1" vectorEffect="non-scaling-stroke" />
              <circle className="homeEquityEndpointHalo" cx={chart.endpoint.x} cy={chart.endpoint.y} r="7" />
              <circle className="homeEquityEndpoint" cx={chart.endpoint.x} cy={chart.endpoint.y} r="3.5" />
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
            <header>
              <div><span>Execution</span><h3>Trading accounts</h3></div>
              {onManageAccounts
                ? <button className="homeManageAccounts" onClick={onManageAccounts} type="button">Manage</button>
                : <a href="#autotrade">Manage</a>}
            </header>
            {isLoading ? (
              <div aria-label="Loading connected accounts" className="homeRows homeSkeletonRows" role="status">
                {[0, 1, 2, 3, 4].map((item) => <div className="homeSkeletonRow" key={item}><i /><span /><b /></div>)}
              </div>
            ) : accounts.length ? (
              <div className="homeRows">
                {accounts.map((account) => (
                  <button
                    aria-expanded={selectedAccountId === account.id}
                    className={`homeAccountRow${selectedAccountId === account.id ? " is-selected" : ""}`}
                    key={account.id}
                    onClick={() => setSelectedAccountId((current) => current === account.id ? null : account.id)}
                    type="button"
                  >
                    <span className="homePlatformMark">{account.platform.slice(0, 2).toUpperCase()}</span>
                    <div><strong>{account.name}</strong><small>{account.platform}</small></div>
                    <div className="homeAccountValue">
                      {Number.isFinite(account.balance) ? <strong>{money(account.balance ?? 0, 0)}</strong> : null}
                      <span className={`homeStatus${account.paused ? " is-paused" : ""}`}><i />{account.paused ? "Paused" : "Ready"}</span>
                    </div>
                    <span className="homeRowChevron" aria-hidden="true">⌄</span>
                    <span className="homeAccountReveal">Independent broker account · {account.detail}</span>
                  </button>
                ))}
              </div>
            ) : <p className="homeEmptyState">No accounts yet. Open Auto-Trade to connect one.</p>}
          </article>
          <article className="homeOnlineList">
            <header><div><span>Workspace</span><h3>Friend accounts</h3></div><strong>{onlineFriendCount}/{friendAccounts.length}</strong></header>
            <div className="codenamesOnlineList">
              <div className="codenamesOnlineSection">Separate Korra logins · {onlineFriendCount} online</div>
              {friendAccounts.length ? friendAccounts.map((account) => (
                <button
                  aria-expanded={selectedPersonId === account.id}
                  className={`codenamesOnlineRow${account.presence ? " is-online" : " is-offline"}${selectedPersonId === account.id ? " is-selected" : ""}`}
                  key={account.id}
                  onClick={() => setSelectedPersonId((current) => current === account.id ? null : account.id)}
                  type="button"
                >
                  <i className="codenamesOnlineDot" />
                  <span className="homeFriendIdentity"><strong>{account.username}</strong><small>{account.presence?.area || "Offline"}</small></span>
                  <span className="codenamesOnlineRole">{account.presence ? "Online" : "Offline"}</span>
                  <span className="homeRowChevron" aria-hidden="true">⌄</span>
                  <span className="homeFriendReveal">Independent friend account · {account.role === "admin" ? "Workspace administrator" : "Workspace member"}</span>
                </button>
              )) : <p className="homeEmptyState">No friend accounts have joined this workspace yet.</p>}
            </div>
          </article>
        </aside>
      </div>

      <article className="homeExecutionHistory">
        <header>
          <div><span>Trade history</span><h3>Recent executions</h3></div>
          <div className="homeExecutionHeaderTools">
            <div className="homeExecutionFilters" role="group" aria-label="Filter successful executions">
              {(["all", "open", "closed"] as const).map((filter) => (
                <button aria-pressed={executionFilter === filter} className={executionFilter === filter ? "is-active" : ""} key={filter} onClick={() => setExecutionFilter(filter)} type="button">
                  {filter[0]!.toUpperCase()}{filter.slice(1)}
                </button>
              ))}
            </div>
            <div className="homeExecutionStats" aria-label="Successful execution summary">
              <span><small>Executed</small><strong>{allSuccessfulExecutions.length}</strong></span>
              <span><small>Closed</small><strong>{executionStats.closed}</strong></span>
              <span><small>Win rate</small><strong>{executionStats.closed ? `${executionStats.winRate.toFixed(1)}%` : "—"}</strong></span>
              <span><small>Net PnL</small><strong className={executionStats.net > 0 ? "up" : executionStats.net < 0 ? "down" : ""}>{executionStats.closed ? `${executionStats.net >= 0 ? "+" : "-"}$${Math.abs(executionStats.net).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</strong></span>
            </div>
          </div>
        </header>
        {successfulExecutions.length ? (
          <div className="homeExecutionRows">
            <div aria-hidden="true" className="homeExecutionColumns">
              <span>Instrument</span><span>Filled</span><span>Size</span><span>Accounts</span><span>Status</span><span>Result</span>
            </div>
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
