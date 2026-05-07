"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  autoTradeMarketLabel,
  autoTradeProvidersForMarket,
  type AutoTradeMarket,
  type AutoTradeProvider,
  type AutoTradeProviderId
} from "@/lib/auto-trade-platforms";
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

function providerStatusClass(provider: AutoTradeProvider): string {
  if (provider.status === "live") return "sent";
  if (provider.status === "adapter_ready") return "skipped";
  return "neutral";
}

function firstProviderId(providers: AutoTradeProvider[]): AutoTradeProviderId {
  return providers.find((provider) => provider.status === "live")?.id ?? providers[0]!.id;
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
    throw new Error(payload.error ?? "Auto-trade connection request failed.");
  }
  return payload;
}

type AutoTradingConnectionPanelProps = {
  market: AutoTradeMarket;
};

export default function AutoTradingConnectionPanel({ market }: AutoTradingConnectionPanelProps) {
  const providers = useMemo(() => autoTradeProvidersForMarket(market), [market]);
  const [selectedProviderId, setSelectedProviderId] = useState<AutoTradeProviderId>(() => firstProviderId(providers));
  const [userName, setUserName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<ProjectXConnectionStatus>(EMPTY_STATUS);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [isChecking, setIsChecking] = useState(market === "futures");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isUpdatingPaused, setIsUpdatingPaused] = useState(false);

  const marketLabel = autoTradeMarketLabel(market);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]!;
  const canConnectSelectedProvider = selectedProvider.id === "projectx" && selectedProvider.status === "live" && market === "futures";
  const storageLabel = status.storageMode === "firebase" ? "Firebase" : "local dev storage";
  const displayUserName = status.userName || userName || "--";
  const pausedAccountIds = new Set(status.pausedAccountIds ?? status.accounts.map((account) => account.id));
  const visibleAccounts = market === "futures" ? status.accounts : [];

  useEffect(() => {
    if (!providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(firstProviderId(providers));
    }
  }, [providers, selectedProviderId]);

  useEffect(() => {
    setIsAddingAccount(false);
  }, [market]);

  async function refreshConnection() {
    if (market !== "futures") {
      setStatus(EMPTY_STATUS);
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "GET",
        cache: "no-store"
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
    } catch (error) {
      setStatus({
        accounts: [],
        connected: false,
        error: error instanceof Error ? error.message : "Auto-trade status check failed."
      });
    } finally {
      setIsChecking(false);
    }
  }

  useEffect(() => {
    void refreshConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);

  useEffect(() => {
    if (!isChecking && !status.connected) setIsAddingAccount(false);
  }, [isChecking, status.connected]);

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConnectSelectedProvider) return;

    setIsConnecting(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          apiKey,
          userName
        })
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
      setApiKey("");
      setIsAddingAccount(false);
    } catch (error) {
      setStatus({
        accounts: [],
        connected: false,
        error: error instanceof Error ? error.message : "Auto-trade connection failed."
      });
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
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
        error: error instanceof Error ? error.message : "Auto-trade disconnect failed."
      }));
    } finally {
      setIsDisconnecting(false);
    }
  }

  async function handleAutoTradePaused(accountId: number, nextPaused: boolean) {
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
      <div className="autoTradeModeStrip" aria-label={`${marketLabel} auto-trade providers`}>
        {providers.map((provider) => (
          <button
            aria-pressed={selectedProvider.id === provider.id}
            className={`autoTradeProviderOption${selectedProvider.id === provider.id ? " active" : ""}`}
            key={provider.id}
            onClick={() => setSelectedProviderId(provider.id)}
            type="button"
          >
            <span>{provider.connectionMode}</span>
            <strong>{provider.shortLabel}</strong>
            <em className={`status ${providerStatusClass(provider)}`}>{provider.statusLabel}</em>
          </button>
        ))}
      </div>

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
            <button type="button" disabled={isChecking || isConnecting || market !== "futures"} onClick={() => refreshConnection()}>
              {isChecking ? "Checking..." : "Refresh"}
            </button>
          </>
        )}
      </div>

      {isAddingAccount ? (
        <div className="autoTradeAddAccount">
          <div className="autoTradeProviderSummary">
            <span>{selectedProvider.label}</span>
            <strong>{selectedProvider.coverage}</strong>
            <p>{selectedProvider.description}</p>
          </div>

          {canConnectSelectedProvider ? (
            <form className="topstepConnectForm" onSubmit={handleConnect}>
              <label>
                <span>TopstepX username</span>
                <input
                  autoComplete="username"
                  name="projectx-user-name"
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
                  name="projectx-api-key"
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
            <div className="topstepAccountEmpty">
              <strong>{selectedProvider.label} is ready in the router</strong>
              <span>Live credentials are not collected yet, so this connector will not place orders until its adapter is implemented.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="topstepAccountList" aria-live="polite">
          {visibleAccounts.length === 0 ? (
            <div className="topstepAccountEmpty">
              <strong>No {marketLabel.toLowerCase()} auto-trade accounts connected</strong>
              <span>Use Add Account to pick a {marketLabel.toLowerCase()} connector. Accounts from the other market stay hidden here.</span>
            </div>
          ) : (
            visibleAccounts.map((account) => {
              const accountPaused = pausedAccountIds.has(account.id);
              const connectionStatus = accountConnectionStatus(account, accountPaused);
              return (
                <div className="topstepAccountRow" key={account.id}>
                  <div className="topstepAccountFields">
                    <div>
                      <span>Provider</span>
                      <strong>ProjectX</strong>
                    </div>
                    <div>
                      <span>Login</span>
                      <strong>{displayUserName}</strong>
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
                    <button className="dangerButton" type="button" disabled={isDisconnecting} onClick={() => handleDisconnect()}>
                      {isDisconnecting ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="topstepConnectionFoot">
        <span>
          {status.persisted && market === "futures" ? `${fmtTime(status.checkedAt)} / saved in ${storageLabel}` : `${marketLabel} view`}
        </span>
        {status.error ? <strong>{status.error}</strong> : null}
      </div>
    </div>
  );
}
