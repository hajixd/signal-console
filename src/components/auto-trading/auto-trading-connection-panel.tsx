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

type SavedAutoTradeConnection = {
  accountId?: string;
  accountName?: string;
  checkedAt?: string;
  connected: boolean;
  connectedAt: string;
  id: AutoTradeProviderId;
  paused: boolean;
  providerLabel: string;
  storageMode?: "firebase" | "local";
};

type ConnectionField = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
};

const CONNECTION_FIELDS: Record<AutoTradeProviderId, ConnectionField[]> = {
  projectx: [],
  tradelocker: [
    { key: "email", label: "Email", placeholder: "trader@example.com", required: true },
    { key: "password", label: "Password", required: true, secret: true },
    { key: "server", label: "Server", placeholder: "demo", required: true },
    { key: "accountId", label: "Account ID", required: true },
    { key: "accNum", label: "Account number", required: true },
    { key: "tradableInstrumentId", label: "Instrument ID", placeholder: "per-symbol id", required: true },
    { key: "routeId", label: "Route ID", placeholder: "TRADE" },
    { key: "symbolMap", label: "Symbol map", placeholder: "EURUSD:EURUSD,XAUUSD:XAUUSD" },
    { key: "sizeMap", label: "Size map", placeholder: "EURUSD:0.1,XAUUSD:0.05" }
  ],
  mt5_bridge: [
    { key: "bridgeUrl", label: "Bridge URL", placeholder: "https://your-vps/place-order", required: true },
    { key: "bridgeSecret", label: "Bridge secret", required: true, secret: true },
    { key: "login", label: "MT5 login", required: true },
    { key: "password", label: "MT5 password", required: true, secret: true },
    { key: "server", label: "MT5 server", required: true },
    { key: "accountId", label: "Account ID" },
    { key: "symbolMap", label: "Symbol map", placeholder: "EURUSD:EURUSD.,XAUUSD:XAUUSDm" },
    { key: "lotMap", label: "Lot map", placeholder: "EURUSD:0.1,XAUUSD:0.05" }
  ],
  ctrader: [
    { key: "bridgeUrl", label: "Bridge URL", placeholder: "https://your-ctrader-bridge/place-order", required: true },
    { key: "bridgeSecret", label: "Bridge secret", required: true, secret: true },
    { key: "accountId", label: "Account ID", required: true },
    { key: "accessToken", label: "Access token", secret: true },
    { key: "symbolMap", label: "Symbol map", placeholder: "EURUSD:1,XAUUSD:2" },
    { key: "sizeMap", label: "Size map", placeholder: "EURUSD:10000,XAUUSD:1" }
  ],
  matchtrader: [
    { key: "platformUrl", label: "Platform URL", required: true },
    { key: "systemUuid", label: "System UUID", required: true },
    { key: "tradingApiToken", label: "Trading API token", required: true, secret: true },
    { key: "coAuthCookie", label: "co-auth cookie", secret: true },
    { key: "accountId", label: "Account ID" },
    { key: "symbolMap", label: "Symbol map", placeholder: "EURUSD:EURUSD,XAUUSD:GOLD" },
    { key: "sizeMap", label: "Size map", placeholder: "EURUSD:0.1,XAUUSD:0.05" }
  ],
  tradovate: [
    { key: "username", label: "Username", required: true },
    { key: "password", label: "Password", required: true, secret: true },
    { key: "accountId", label: "Account ID", required: true },
    { key: "accountSpec", label: "Account spec" },
    { key: "appId", label: "App ID", placeholder: "TradingBot" },
    { key: "appVersion", label: "App version", placeholder: "1.0" },
    { key: "cid", label: "CID" },
    { key: "secret", label: "Secret", secret: true },
    { key: "symbolMap", label: "Symbol map", placeholder: "ES:MESM6,NQ:MNQM6" },
    { key: "sizeMap", label: "Size map", placeholder: "ES:1,NQ:1" }
  ],
  rithmic: [
    { key: "bridgeUrl", label: "Bridge URL", placeholder: "https://your-rithmic-bridge/place-order", required: true },
    { key: "bridgeSecret", label: "Bridge secret", required: true, secret: true },
    { key: "login", label: "Rithmic login", required: true },
    { key: "password", label: "Rithmic password", required: true, secret: true },
    { key: "server", label: "System", placeholder: "Rithmic Paper Trading", required: true },
    { key: "accountId", label: "Account ID", required: true },
    { key: "symbolMap", label: "Symbol map", placeholder: "ES:MESM6,NQ:MNQM6" },
    { key: "sizeMap", label: "Size map", placeholder: "ES:1,NQ:1" }
  ]
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

async function parseSavedConnections(response: Response): Promise<{ connections: SavedAutoTradeConnection[]; error?: string }> {
  const payload = (await response.json().catch(() => ({ connections: [] }))) as { connections?: SavedAutoTradeConnection[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Auto-trade connection request failed.");
  return { connections: payload.connections ?? [] };
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
  const [savedConnections, setSavedConnections] = useState<SavedAutoTradeConnection[]>([]);
  const [genericFields, setGenericFields] = useState<Record<string, string>>({});

  const marketLabel = autoTradeMarketLabel(market);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]!;
  const canConnectSelectedProvider = selectedProvider.id === "projectx" && selectedProvider.status === "live" && market === "futures";
  const storageLabel = status.storageMode === "firebase" ? "Firebase" : "local dev storage";
  const displayUserName = status.userName || userName || "--";
  const pausedAccountIds = new Set(status.pausedAccountIds ?? status.accounts.map((account) => account.id));
  const visibleAccounts = market === "futures" ? status.accounts : [];
  const visibleSavedConnections = savedConnections.filter((connection) => providers.some((provider) => provider.id === connection.id));
  const selectedProviderFields = CONNECTION_FIELDS[selectedProvider.id] ?? [];

  useEffect(() => {
    if (!providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(firstProviderId(providers));
    }
  }, [providers, selectedProviderId]);

  useEffect(() => {
    setIsAddingAccount(false);
    setGenericFields({});
  }, [market]);

  async function refreshSavedConnections() {
    try {
      const response = await fetch("/api/auto-trading/connections", { cache: "no-store" });
      const payload = await parseSavedConnections(response);
      setSavedConnections(payload.connections);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Auto-trade connection status check failed."
      }));
    }
  }

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
    void refreshSavedConnections();
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

  async function handleGenericConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsConnecting(true);
    try {
      const response = await fetch("/api/auto-trading/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: genericFields.accountId,
          accountName: genericFields.accountName || genericFields.login || genericFields.username || genericFields.email,
          fields: genericFields,
          providerId: selectedProvider.id
        })
      });
      const payload = await parseSavedConnections(response);
      setSavedConnections(payload.connections);
      setGenericFields({});
      setIsAddingAccount(false);
    } catch (error) {
      setStatus((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Auto-trade connection failed."
      }));
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

  async function handleGenericDisconnect(providerId: AutoTradeProviderId) {
    setIsDisconnecting(true);
    try {
      const response = await fetch(`/api/auto-trading/connections?providerId=${encodeURIComponent(providerId)}`, {
        method: "DELETE"
      });
      const payload = await parseSavedConnections(response);
      setSavedConnections(payload.connections);
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

  async function handleGenericPaused(providerId: AutoTradeProviderId, nextPaused: boolean) {
    setIsUpdatingPaused(true);
    try {
      const response = await fetch("/api/auto-trading/connections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: nextPaused, providerId })
      });
      const payload = await parseSavedConnections(response);
      setSavedConnections(payload.connections);
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
            <button type="button" disabled={isChecking || isConnecting || market !== "futures"} onClick={() => refreshConnection()}>
              {isChecking ? "Checking..." : "Refresh"}
            </button>
          </>
        )}
      </div>

      {isAddingAccount ? (
        <div className="autoTradeAddAccount">
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
          ) : selectedProviderFields.length ? (
            <form className="topstepConnectForm" onSubmit={handleGenericConnect}>
              {selectedProviderFields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <input
                    autoComplete={field.secret ? "off" : undefined}
                    name={`${selectedProvider.id}-${field.key}`}
                    onChange={(event) =>
                      setGenericFields((current) => ({
                        ...current,
                        [field.key]: event.target.value
                      }))
                    }
                    placeholder={field.placeholder}
                    required={field.required}
                    type={field.secret ? "password" : "text"}
                    value={genericFields[field.key] ?? ""}
                  />
                </label>
              ))}
              <button type="submit" disabled={isConnecting}>
                {isConnecting ? "Connecting..." : "Connect Account"}
              </button>
            </form>
          ) : (
            <div className="topstepAccountEmpty">
              <strong>{selectedProvider.label} is ready in the router</strong>
              <span>Use the matching Vercel env vars or bridge URL for this provider; the in-app form only stores ProjectX credentials.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="topstepAccountList" aria-live="polite">
          {visibleAccounts.length === 0 && visibleSavedConnections.length === 0 ? (
            <div className="topstepAccountEmpty">
              <strong>No {marketLabel.toLowerCase()} auto-trade accounts connected</strong>
              <span>Use Add Account to pick a {marketLabel.toLowerCase()} connector. Accounts from the other market stay hidden here.</span>
            </div>
          ) : (
            <>
              {visibleAccounts.map((account) => {
                const accountPaused = pausedAccountIds.has(account.id);
                const connectionStatus = accountConnectionStatus(account, accountPaused);
                return (
                  <div className="topstepAccountRow" key={`projectx-${account.id}`}>
                    <div className="topstepAccountFields">
                      <div>
                        <span>Provider</span>
                        <strong>ProjectX</strong>
                      </div>
                      <div>
                        <span>Platform</span>
                        <strong>TopstepX / Futures</strong>
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
              })}
              {visibleSavedConnections.map((connection) => {
                const provider = providers.find((item) => item.id === connection.id);
                return (
                  <div className="topstepAccountRow" key={connection.id}>
                    <div className="topstepAccountFields">
                      <div>
                        <span>Provider</span>
                        <strong>{connection.providerLabel}</strong>
                      </div>
                      <div>
                        <span>Platform</span>
                        <strong>{provider?.shortLabel ?? connection.id}</strong>
                      </div>
                      <div>
                        <span>Account</span>
                        <strong>{connection.accountName ?? connection.accountId ?? "--"}</strong>
                      </div>
                      <div>
                        <span>Account ID</span>
                        <strong>{connection.accountId ?? "--"}</strong>
                      </div>
                      <div>
                        <span>Saved</span>
                        <strong>{fmtTime(connection.checkedAt ?? connection.connectedAt)}</strong>
                      </div>
                      <div>
                        <span>Status</span>
                        <strong className={`topstepStatusValue status ${connection.paused ? "skipped" : "sent"}`}>
                          <span aria-hidden="true" className={connection.paused ? "statusDot orange" : "statusDot green"} />
                          {connection.paused ? "Paused" : "Connected"}
                        </strong>
                      </div>
                    </div>
                    <div className="topstepAccountControls">
                      <button
                        className={connection.paused ? "playButton" : "pauseButton"}
                        type="button"
                        disabled={isUpdatingPaused || isDisconnecting}
                        onClick={() => handleGenericPaused(connection.id, !connection.paused)}
                      >
                        {isUpdatingPaused ? "Updating..." : connection.paused ? "Play" : "Pause"}
                      </button>
                      <button className="dangerButton" type="button" disabled={isDisconnecting} onClick={() => handleGenericDisconnect(connection.id)}>
                        {isDisconnecting ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
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
