"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Heartbeat = {
  eaVersion?: string;
  terminalConnected: boolean;
  tradeAllowed: boolean;
  accountLogin?: number;
  accountServer?: string;
  lastError?: string;
  updatedAt?: string;
};

type AccountState = {
  balance?: number;
  equity?: number;
  floatingPnL?: number;
  openPositionCount?: number;
  marginLevelPct?: number;
  updatedAt?: string;
};

type ExecutionStats = {
  total: number;
  filled: number;
  rejected: number;
  pending: number;
  fillRatePct: number | null;
  avgSlippagePips: number | null;
  riskDeployedUsd: number;
  closed: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  realizedPnlUsd: number;
  realizedR: number | null;
  lastOrderAt?: string;
};

type OrderView = {
  id: string;
  status: string;
  symbol: string;
  side: string;
  volume: number;
  riskUsd?: number;
  fillPrice?: number;
  slippagePips?: number;
  errorMessage?: string;
  createdAt?: string;
  closeProfit?: number;
  closeReason?: string;
};

type StatusResponse = {
  accountMismatch?: string | null;
  backendConfigured: boolean;
  configured: boolean;
  provider: string | null;
  providerSelected: boolean;
  storageConfigured: boolean;
  tokenConfigured: boolean;
  bridgeAccountId: string;
  connectedAccount?: {
    accountName?: string;
    firmLabel?: string;
    login?: string;
    paused: boolean;
    server?: string;
  } | null;
  heartbeat: Heartbeat | null;
  state: AccountState | null;
  stats: ExecutionStats | null;
  orders: OrderView[];
  error?: string;
};

const POLL_MS = 10_000;

function freshness(updatedAt: string | undefined): { label: string; tone: "live" | "stale" | "offline" } {
  if (!updatedAt) return { label: "no signal", tone: "offline" };
  const ageMs = Date.now() - Date.parse(updatedAt);
  if (!Number.isFinite(ageMs)) return { label: "no signal", tone: "offline" };
  if (ageMs < 30_000) return { label: "live", tone: "live" };
  if (ageMs < 120_000) return { label: "stale", tone: "stale" };
  return { label: "offline", tone: "offline" };
}

function ago(updatedAt: string | undefined): string {
  if (!updatedAt) return "—";
  const ageMs = Date.now() - Date.parse(updatedAt);
  if (!Number.isFinite(ageMs)) return "—";
  const s = Math.max(0, Math.round(ageMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function money(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function pnlClass(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return undefined;
  return value > 0 ? "mt5EaOk" : "mt5EaWarn";
}

export default function Mt5EaStatusPanel() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/auto-trading/mt5-ea-status", { signal, cache: "no-store" });
      if (res.status === 401) {
        setError("Admin access required.");
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as StatusResponse;
      setData(json);
      setError(json.error ?? null);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    timer.current = setInterval(() => void load(), POLL_MS);
    return () => {
      controller.abort();
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  if (loading && !data) {
    return (
      <section className="mt5EaPanel">
        <div className="mt5EaHead">
          <strong>MT5 Execution</strong>
        </div>
        <p className="mt5EaNote">Loading…</p>
      </section>
    );
  }

  if (error === "Admin access required.") {
    return null; // hidden for non-admin viewers
  }

  const hb = data?.heartbeat ?? null;
  const state = data?.state ?? null;
  const stats = data?.stats ?? null;
  const orders = data?.orders ?? [];
  const conn = !data?.configured
    ? { label: "setup required", tone: "offline" as const }
    : data.accountMismatch
      ? { label: "account mismatch", tone: "offline" as const }
    : !hb
      ? { label: "waiting for EA", tone: "stale" as const }
      : freshness(hb.updatedAt);
  const setupIssues = data
    ? [
        !data.tokenConfigured ? "the secure EA token" : null,
        !data.storageConfigured ? "the Turso order queue" : null,
        data.connectedAccount?.paused ? "the connected account is paused" : null,
        !data.providerSelected
          ? `forex routing${data.provider ? ` (currently ${data.provider})` : ""}`
          : null
      ].filter((issue): issue is string => Boolean(issue))
    : [];

  return (
    <section className="mt5EaPanel">
      <div className="mt5EaHead">
        <div>
          <strong>MT5 Execution</strong>
          <span className="mt5EaAccount">
            {data?.connectedAccount?.accountName || data?.bridgeAccountId}
            {data?.connectedAccount?.login ? ` · ${data.connectedAccount.login}` : ""}
          </span>
        </div>
        <span className={`mt5EaBadge mt5EaBadge--${conn.tone}`}>{conn.label}</span>
      </div>

      {data && !data.configured ? (
        <p className="mt5EaNote">
          MT5 setup is incomplete: {setupIssues.join(", ")}. No forex orders are being sent to this EA.
        </p>
      ) : data?.accountMismatch ? (
        <p className="mt5EaNote mt5EaWarn">
          {data.accountMismatch} Open the EA settings and set Connection ID to <code>{data.bridgeAccountId}</code>.
        </p>
      ) : !hb ? (
        <p className="mt5EaNote">
          Waiting for the EA — no heartbeat yet for <code>{data?.bridgeAccountId}</code>. Start the EA on the MT5 terminal and confirm the green smiley.
        </p>
      ) : (
        <>
          <div className="mt5EaMeta">
            <span>Last heartbeat {ago(hb.updatedAt)}</span>
            {hb.accountLogin ? <span>Login {hb.accountLogin}</span> : null}
            {hb.accountServer || data?.connectedAccount?.server ? <span>{hb.accountServer || data?.connectedAccount?.server}</span> : null}
            {hb.eaVersion ? <span>EA {hb.eaVersion}</span> : null}
            <span className={hb.tradeAllowed ? "mt5EaOk" : "mt5EaWarn"}>
              {hb.tradeAllowed ? "Algo trading on" : "Algo trading OFF"}
            </span>
          </div>
          {hb.lastError ? <p className="mt5EaWarn">EA error: {hb.lastError}</p> : null}

          <div className="mt5EaStatGrid">
            <div className="mt5EaStat"><span>Balance</span><strong>{money(state?.balance)}</strong></div>
            <div className="mt5EaStat"><span>Equity</span><strong>{money(state?.equity)}</strong></div>
            <div className="mt5EaStat"><span>Floating P&L</span><strong>{money(state?.floatingPnL)}</strong></div>
            <div className="mt5EaStat"><span>Open positions</span><strong>{state?.openPositionCount ?? "—"}</strong></div>
            <div className="mt5EaStat"><span>Orders</span><strong>{stats?.total ?? 0}</strong></div>
            <div className="mt5EaStat"><span>Filled</span><strong>{stats?.filled ?? 0}</strong></div>
            <div className="mt5EaStat"><span>Rejected</span><strong>{stats?.rejected ?? 0}</strong></div>
            <div className="mt5EaStat"><span>Pending</span><strong>{stats?.pending ?? 0}</strong></div>
            <div className="mt5EaStat">
              <span>Fill rate</span>
              <strong>{stats?.fillRatePct == null ? "—" : `${stats.fillRatePct.toFixed(0)}%`}</strong>
            </div>
            <div className="mt5EaStat">
              <span>Avg slippage</span>
              <strong>{stats?.avgSlippagePips == null ? "—" : `${stats.avgSlippagePips.toFixed(1)} pips`}</strong>
            </div>
            <div className="mt5EaStat">
              <span>Closed</span>
              <strong>{stats?.closed ?? 0}</strong>
            </div>
            <div className="mt5EaStat">
              <span>Win rate</span>
              <strong>{stats?.winRatePct == null ? "—" : `${stats.winRatePct.toFixed(0)}%`}</strong>
            </div>
            <div className="mt5EaStat">
              <span>Realized R</span>
              <strong className={pnlClass(stats?.realizedR ?? undefined)}>
                {stats?.realizedR == null ? "—" : `${stats.realizedR >= 0 ? "+" : ""}${stats.realizedR.toFixed(2)}R`}
              </strong>
            </div>
            <div className="mt5EaStat">
              <span>Realized P&L</span>
              <strong className={pnlClass(stats?.realizedPnlUsd)}>
                {stats?.closed ? signedMoney(stats?.realizedPnlUsd) : "—"}
              </strong>
            </div>
          </div>

          {orders.length ? (
            <div className="mt5EaTableWrap">
              <table className="mt5EaTable">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Lots</th>
                    <th>Status</th>
                    <th>Fill</th>
                    <th>Slip</th>
                    <th>P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 25).map((order) => (
                    <tr key={order.id} title={order.errorMessage ?? order.closeReason ?? undefined}>
                      <td>{ago(order.createdAt)}</td>
                      <td>{order.symbol}</td>
                      <td className={order.side === "buy" ? "mt5EaOk" : "mt5EaWarn"}>{order.side}</td>
                      <td>{order.volume}</td>
                      <td><span className={`mt5EaTag mt5EaTag--${order.status}`}>{order.status}</span></td>
                      <td>{order.fillPrice ?? "—"}</td>
                      <td>{order.slippagePips == null ? "—" : order.slippagePips.toFixed(1)}</td>
                      <td className={pnlClass(order.closeProfit)}>{order.closeProfit == null ? "—" : signedMoney(order.closeProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt5EaNote">No orders queued yet.</p>
          )}
        </>
      )}
    </section>
  );
}
