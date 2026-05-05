"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ProjectXAccount, ProjectXConnectionStatus } from "@/lib/projectx";

const EMPTY_STATUS: ProjectXConnectionStatus = {
  accounts: [],
  connected: false
};

function fmtMoney(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function fmtTime(value: string | undefined): string {
  if (!value) return "Not checked yet";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    timeZoneName: "short"
  }).format(new Date(value));
}

function accountStatusClass(account: ProjectXAccount): string {
  if (account.canTrade) return "status sent";
  if (!account.isVisible) return "status skipped";
  return "status failed";
}

function accountStatusLabel(account: ProjectXAccount): string {
  if (account.canTrade) return "can trade";
  if (!account.isVisible) return "hidden";
  return "blocked";
}

async function parseConnectionResponse(response: Response): Promise<ProjectXConnectionStatus> {
  const payload = (await response.json().catch(() => EMPTY_STATUS)) as ProjectXConnectionStatus;
  if (!response.ok) {
    throw new Error(payload.error ?? "TopstepX connection request failed.");
  }
  return payload;
}

export default function TopstepConnectionPanel() {
  const [userName, setUserName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<ProjectXConnectionStatus>(EMPTY_STATUS);
  const [message, setMessage] = useState("");
  const [isChecking, setIsChecking] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const tradeableAccounts = useMemo(() => status.accounts.filter((account) => account.canTrade).length, [status.accounts]);
  const statusClass = status.connected ? "status sent" : status.error ? "status failed" : "status skipped";
  const statusLabel = status.connected ? "connected" : status.error ? "needs attention" : "not connected";
  const storageLabel = status.storageMode === "firebase" ? "Firebase" : "local dev storage";
  const ownerLabel = status.userName ? ` as ${status.userName}` : "";

  async function refreshConnection(silent = false) {
    if (!silent) setMessage("");
    setIsChecking(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "GET",
        cache: "no-store"
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
      if (!silent) {
        setMessage(nextStatus.connected ? "TopstepX account list refreshed." : nextStatus.error ?? "No TopstepX account connected.");
      }
    } catch (error) {
      setStatus({
        accounts: [],
        connected: false,
        error: error instanceof Error ? error.message : "TopstepX status check failed."
      });
      if (!silent) setMessage(error instanceof Error ? error.message : "TopstepX status check failed.");
    } finally {
      setIsChecking(false);
    }
  }

  useEffect(() => {
    void refreshConnection(true);
  }, []);

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsConnecting(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          userName,
          apiKey
        })
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
      setApiKey("");
      setMessage(nextStatus.accounts.length ? "TopstepX account connected." : "Connected, but no active accounts were returned.");
    } catch (error) {
      setStatus({
        accounts: [],
        connected: false,
        error: error instanceof Error ? error.message : "TopstepX connection failed."
      });
      setMessage(error instanceof Error ? error.message : "TopstepX connection failed.");
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
    setMessage("");
    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "DELETE"
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
      setMessage("TopstepX account disconnected from this browser.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TopstepX disconnect failed.");
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <div className="topstepConnection">
      <div className="topstepConnectionSummary">
        <div className="topstepConnectionState">
          <span className={statusClass}>{isChecking ? "checking" : statusLabel}</span>
          <strong>
            {status.connected
              ? `${tradeableAccounts} tradeable / ${status.accounts.length} active${ownerLabel}`
              : "Connect a TopstepX account"}
          </strong>
          <small>Use the API key from TopstepX settings. The encrypted 24-hour ProjectX session is saved in {storageLabel}.</small>
        </div>
        <div className="topstepConnectionActions">
          <button type="button" disabled={isChecking || isConnecting} onClick={() => refreshConnection()}>
            {isChecking ? "Checking..." : "Refresh"}
          </button>
          {status.connected ? (
            <button type="button" disabled={isDisconnecting} onClick={handleDisconnect}>
              {isDisconnecting ? "Disconnecting..." : "Disconnect"}
            </button>
          ) : null}
        </div>
      </div>

      <form className="topstepConnectForm" onSubmit={handleConnect}>
        <label>
          <span>TopstepX username</span>
          <input
            autoComplete="username"
            name="topstep-user-name"
            onChange={(event) => setUserName(event.target.value)}
            placeholder="trader@example.com"
            required
            type="text"
            value={userName}
          />
        </label>
        <label>
          <span>ProjectX API key</span>
          <input
            autoComplete="off"
            name="topstep-api-key"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste API key"
            required
            type="password"
            value={apiKey}
          />
        </label>
        <button type="submit" disabled={isConnecting}>
          {isConnecting ? "Connecting..." : status.connected ? "Reconnect" : "Connect Account"}
        </button>
      </form>

      <div className="topstepAccountList" aria-live="polite">
        {status.accounts.length === 0 ? (
          <div className="topstepAccountEmpty">
            <strong>{isChecking ? "Checking TopstepX session" : "No connected accounts"}</strong>
            <span>{status.error ?? "Connected TopstepX accounts will appear here."}</span>
          </div>
        ) : (
          status.accounts.map((account) => (
            <div className="topstepAccountRow" key={account.id}>
              <div>
                <span>Account</span>
                <strong>{account.name}</strong>
              </div>
              <div>
                <span>ID</span>
                <strong>{account.id}</strong>
              </div>
              <div>
                <span>Balance</span>
                <strong>{fmtMoney(account.balance)}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong className={accountStatusClass(account)}>{accountStatusLabel(account)}</strong>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="topstepConnectionFoot">
        <span>{status.persisted ? `${fmtTime(status.checkedAt)} / saved in ${storageLabel}` : fmtTime(status.checkedAt)}</span>
        <strong>{message || status.error || "Ready to connect through ProjectX."}</strong>
      </div>
    </div>
  );
}
