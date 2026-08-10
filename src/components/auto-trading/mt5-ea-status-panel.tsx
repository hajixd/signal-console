"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AccountState = {
  balance?: number;
  equity?: number;
};

type ConnectedAccount = {
  accountName?: string;
  connectionId: string;
  firmLabel?: string;
  login?: string;
  paused: boolean;
  server?: string;
};

type StatusResponse = {
  backendConfigured: boolean;
  configured: boolean;
  connectedAccount?: ConnectedAccount | null;
  connectedAccounts?: ConnectedAccount[];
  credentialVerified?: boolean;
  error?: string;
  executionMode?: "credential_bridge" | "terminal_ea";
  state: AccountState | null;
};

const POLL_MS = 10_000;

function money(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function Mt5EaStatusPanel() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/auto-trading/mt5-ea-status", { signal, cache: "no-store" });
      if (response.status === 401) {
        setData(null);
        setError("Admin access required.");
        return;
      }
      if (!response.ok) throw new Error(`status ${response.status}`);
      const payload = (await response.json()) as StatusResponse;
      setData(payload);
      setError(payload.error ?? null);
    } catch (loadError) {
      if ((loadError as { name?: string })?.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
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

  if (error === "Admin access required.") return null;

  const account = data?.connectedAccount ?? null;
  const credentialMode = data?.executionMode === "credential_bridge";
  const accountCount = data?.connectedAccounts?.length ?? 0;
  const verified = credentialMode && data?.credentialVerified === true;
  const badge = loading && !data
    ? { label: "checking", tone: "stale" }
    : !credentialMode
      ? { label: "central setup pending", tone: "stale" }
      : !account
        ? { label: "ready", tone: "live" }
        : account.paused
          ? { label: "paused", tone: "stale" }
          : verified
            ? { label: "connected", tone: "live" }
            : { label: "connection failed", tone: "offline" };

  return (
    <section className="mt5EaPanel">
      <div className="mt5EaHead">
        <div>
          <strong>MT5 Auto-Trading</strong>
          <span className="mt5EaAccount">
            {account?.accountName || account?.firmLabel || "Managed by Korra"}
            {account?.login ? ` · ${account.login}` : ""}
            {accountCount > 1 ? ` · ${accountCount} accounts` : ""}
          </span>
        </div>
        <span className={`mt5EaBadge mt5EaBadge--${badge.tone}`}>{badge.label}</span>
      </div>

      {!credentialMode ? (
        <p className="mt5EaNote">
          Korra&apos;s central MT5 connection is being completed. You will not need to download an EA, configure a Connection ID, or keep MT5 open. When it is ready, reconnect this account once with its login, master password, and broker server.
        </p>
      ) : !account ? (
        <p className="mt5EaNote">
          Add an MT5 account above using its login, master password, and broker server. Korra handles everything else.
        </p>
      ) : account.paused ? (
        <p className="mt5EaNote">This account is connected but paused. Select Play to resume auto-trading.</p>
      ) : verified ? (
        <>
          <p className="mt5EaNote mt5EaOk">
            Secure connection verified for login {account.login} on {account.server}. Active forex signals will be sent automatically.
          </p>
          <div className="mt5EaStatGrid">
            <div className="mt5EaStat"><span>Balance</span><strong>{money(data?.state?.balance)}</strong></div>
            <div className="mt5EaStat"><span>Equity</span><strong>{money(data?.state?.equity)}</strong></div>
          </div>
        </>
      ) : (
        <p className="mt5EaNote mt5EaWarn">
          {error || "Korra could not verify this account. Check the login, master password, and broker server, then reconnect it."}
        </p>
      )}
    </section>
  );
}
