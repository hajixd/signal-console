"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ProjectXAccount, ProjectXConnectionStatus } from "@/lib/projectx";

const EMPTY_STATUS: ProjectXConnectionStatus = {
  accounts: [],
  connected: false
};

const MOCK_ACCOUNTS: ProjectXAccount[] = [
  {
    id: 1000001,
    name: "Mock Topstep Account",
    balance: 100000,
    canTrade: true,
    isVisible: true
  },
  {
    id: 1000002,
    name: "Mock Topstep Account 2",
    balance: 50000,
    canTrade: true,
    isVisible: true
  }
];

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

function accountConnectionStatus(account: ProjectXAccount, autoTradePaused: boolean): { className: string; dotClassName: string; label: string } {
  if (!account.canTrade || !account.isVisible) return { className: "status failed", dotClassName: "statusDot red", label: "Disconnected" };
  if (autoTradePaused) return { className: "status skipped", dotClassName: "statusDot orange", label: "Paused" };
  return { className: accountStatusClass(account), dotClassName: "statusDot green", label: "Connected" };
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
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isUpdatingPaused, setIsUpdatingPaused] = useState(false);
  const [hiddenMockAccountIds, setHiddenMockAccountIds] = useState<Set<number>>(new Set());
  const [mockPausedAccountIds, setMockPausedAccountIds] = useState<Set<number>>(new Set(MOCK_ACCOUNTS.map((account) => account.id)));

  const storageLabel = status.storageMode === "firebase" ? "Firebase" : "local dev storage";
  const displayUserName = status.userName || userName || "--";
  const pausedAccountIds = new Set(status.pausedAccountIds ?? status.accounts.map((account) => account.id));
  const visibleAccounts = status.accounts.length ? status.accounts : MOCK_ACCOUNTS.filter((account) => !hiddenMockAccountIds.has(account.id));

  async function refreshConnection(silent = false) {
    setIsChecking(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "GET",
        cache: "no-store"
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
      setHiddenMockAccountIds(new Set());
    } catch (error) {
      setStatus({
        accounts: [],
        connected: false,
        error: error instanceof Error ? error.message : "TopstepX status check failed."
      });
    } finally {
      setIsChecking(false);
    }
  }

  useEffect(() => {
    void refreshConnection(true);
  }, []);

  useEffect(() => {
    if (!isChecking && !status.connected) setIsAddingAccount(false);
  }, [isChecking, status.connected]);

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setHiddenMockAccountIds(new Set());
      setIsAddingAccount(false);
    } catch (error) {
      setStatus({
        accounts: [],
        connected: false,
        error: error instanceof Error ? error.message : "TopstepX connection failed."
      });
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect(accountId: number) {
    if (!status.accounts.length) {
      setHiddenMockAccountIds((current) => new Set([...current, accountId]));
      return;
    }

    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "DELETE"
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
      setIsAddingAccount(false);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "TopstepX disconnect failed."
      }));
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function handleAutoTradePaused(accountId: number, nextPaused: boolean) {
    if (!status.accounts.length) {
      setMockPausedAccountIds((current) => {
        const next = new Set(current);
        if (nextPaused) {
          next.add(accountId);
        } else {
          next.delete(accountId);
        }
        return next;
      });
      return;
    }

    setIsUpdatingPaused(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          accountId,
          autoTradePaused: nextPaused
        })
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Auto-trade status update failed."
      }));
    } finally {
      setIsUpdatingPaused(false);
    }
  }

  return (
    <div className="topstepConnection">
      <div className="topstepConnectionActions topstepPrimaryActions">
        {isAddingAccount ? (
          <button type="button" onClick={() => setIsAddingAccount(false)}>
            Back to Accounts
          </button>
        ) : (
          <>
            <button type="button" onClick={() => setIsAddingAccount(true)}>
              Add Account
            </button>
            <button type="button" disabled={isChecking || isConnecting} onClick={() => refreshConnection()}>
              {isChecking ? "Checking..." : "Refresh"}
            </button>
          </>
        )}
      </div>

      {isAddingAccount ? (
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
      ) : (
        <div className="topstepAccountList" aria-live="polite">
          {visibleAccounts.map((account) => {
            const accountPaused = status.accounts.length ? pausedAccountIds.has(account.id) : mockPausedAccountIds.has(account.id);
            const connectionStatus = accountConnectionStatus(account, accountPaused);
            const accountEmail = status.accounts.length ? displayUserName : "mock@projectx.com";
            return (
              <div className="topstepAccountRow" key={account.id}>
                <div className="topstepAccountFields">
                  <div>
                    <span>ProjectX email</span>
                    <strong>{accountEmail}</strong>
                  </div>
                  <div>
                    <span>Account number</span>
                    <strong>{account.id}</strong>
                  </div>
                  <div>
                    <span>Balance</span>
                    <strong>{fmtMoney(account.balance)}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong className={`topstepStatusValue ${connectionStatus.className}`}>
                      <span aria-hidden="true" className={connectionStatus.dotClassName} />
                      {connectionStatus.label}
                    </strong>
                  </div>
                </div>
                <div className="topstepAccountControls">
                  <button
                    className={accountPaused ? "playButton" : "pauseButton"}
                    type="button"
                    disabled={isUpdatingPaused || isDisconnecting}
                    onClick={() => handleAutoTradePaused(account.id, !accountPaused)}
                  >
                    {isUpdatingPaused ? "Updating..." : accountPaused ? "Play" : "Pause"}
                  </button>
                  <button className="dangerButton" type="button" disabled={isDisconnecting} onClick={() => handleDisconnect(account.id)}>
                    {isDisconnecting ? "Removing..." : "Remove"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="topstepConnectionFoot">
        <span>{status.persisted ? `${fmtTime(status.checkedAt)} / saved in ${storageLabel}` : fmtTime(status.checkedAt)}</span>
        {status.error ? <strong>{status.error}</strong> : null}
      </div>
    </div>
  );
}
