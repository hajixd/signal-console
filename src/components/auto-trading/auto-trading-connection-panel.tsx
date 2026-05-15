"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT,
  AUTO_TRADE_ACCESS_CODE_MAX_LENGTH,
  cleanAccessCode,
  savedAccountMode,
  type AutoTradeAccountMode
} from "@/components/auto-trading/auto-trade-account-mode";
import {
  autoTradeMarketLabel,
  autoTradeProviderFullyFunctioning,
  autoTradeProvidersForMarket,
  type AutoTradeMarket,
  type AutoTradeProvider,
  type AutoTradeProviderId
} from "@/lib/auto-trade-platforms";
import type { ProjectXAccount, ProjectXConnectionStatus, ProjectXConnectionSummary } from "@/lib/projectx";

const EMPTY_STATUS: ProjectXConnectionStatus = {
  accounts: [],
  connected: false
};

const ACCESS_CODE_MAX_LENGTH = AUTO_TRADE_ACCESS_CODE_MAX_LENGTH;
const FOLDER_UNLOCK_CODE_MAX_LENGTH = 5;

type SavedAutoTradeConnection = {
  accountId?: string;
  accountName?: string;
  checkedAt?: string;
  connected: boolean;
  connectedAt: string;
  firmId?: string;
  firmLabel?: string;
  id: AutoTradeProviderId;
  paused: boolean;
  providerLabel: string;
  storageMode?: "firebase" | "local";
};

type ConnectionField = {
  advanced?: boolean;
  defaultValue?: string;
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
};

type PropFirmOption = {
  id: string;
  label: string;
  markets: AutoTradeMarket[];
  platformIds: AutoTradeProviderId[];
};

const PROP_FIRM_OPTIONS: PropFirmOption[] = [
  { id: "topstep", label: "Topstep", markets: ["futures"], platformIds: ["projectx"] },
  { id: "apex", label: "Apex Trader Funding", markets: ["futures"], platformIds: ["tradovate", "rithmic"] },
  { id: "my-funded-futures", label: "MyFundedFutures", markets: ["futures"], platformIds: ["tradovate"] },
  { id: "take-profit-trader", label: "Take Profit Trader", markets: ["futures"], platformIds: ["tradovate", "rithmic"] },
  { id: "tradeify", label: "Tradeify", markets: ["futures"], platformIds: ["tradovate"] },
  { id: "elite-trader-funding", label: "Elite Trader Funding", markets: ["futures"], platformIds: ["tradovate"] },
  { id: "earn2trade", label: "Earn2Trade", markets: ["futures"], platformIds: ["tradovate", "rithmic"] },
  { id: "leeloo", label: "Leeloo Trading", markets: ["futures"], platformIds: ["rithmic"] },
  { id: "bulenox", label: "Bulenox", markets: ["futures"], platformIds: ["rithmic"] },
  { id: "oneup", label: "OneUp Trader", markets: ["futures"], platformIds: ["rithmic"] },
  { id: "e8", label: "E8 Markets", markets: ["forex"], platformIds: ["tradelocker", "matchtrader", "ctrader", "mt5_bridge"] },
  { id: "ftmo", label: "FTMO", markets: ["forex"], platformIds: ["mt5_bridge", "ctrader"] },
  { id: "the5ers", label: "The5ers", markets: ["forex"], platformIds: ["mt5_bridge", "ctrader"] },
  { id: "fundednext", label: "FundedNext", markets: ["forex"], platformIds: ["mt5_bridge", "ctrader", "matchtrader"] },
  { id: "fundingpips", label: "FundingPips", markets: ["forex"], platformIds: ["mt5_bridge", "ctrader", "matchtrader"] },
  { id: "funded-trading-plus", label: "Funded Trading Plus", markets: ["forex"], platformIds: ["mt5_bridge", "ctrader", "matchtrader"] },
  { id: "alpha-capital", label: "Alpha Capital Group", markets: ["forex"], platformIds: ["mt5_bridge", "ctrader", "tradelocker"] },
  { id: "blue-guardian", label: "Blue Guardian", markets: ["forex"], platformIds: ["matchtrader", "tradelocker", "mt5_bridge"] },
  { id: "goat-funded-trader", label: "GOAT Funded Trader", markets: ["forex"], platformIds: ["ctrader", "tradelocker", "matchtrader", "mt5_bridge"] },
  { id: "brightfunded", label: "BrightFunded", markets: ["forex"], platformIds: ["mt5_bridge", "ctrader"] },
  { id: "fxify", label: "FXIFY", markets: ["forex"], platformIds: ["mt5_bridge"] },
  { id: "funderpro", label: "FunderPro", markets: ["forex"], platformIds: ["mt5_bridge", "ctrader", "tradelocker"] }
];

const CONNECTION_FIELDS: Record<AutoTradeProviderId, ConnectionField[]> = {
  projectx: [],
  tradelocker: [
    { key: "email", label: "TradeLocker email", placeholder: "trader@example.com", required: true },
    { key: "password", label: "TradeLocker password", required: true, secret: true },
    { key: "server", label: "TradeLocker server", defaultValue: "demo", placeholder: "demo / E8 / FPR", required: true },
    { advanced: true, key: "accountId", label: "Account ID" },
    { advanced: true, key: "accountSize", label: "Account size", placeholder: "50000" },
    { advanced: true, key: "accNum", label: "Account number" },
    { advanced: true, key: "tradableInstrumentId", label: "Instrument ID", placeholder: "auto-discovered when possible" },
    { advanced: true, defaultValue: "TRADE", key: "routeId", label: "Route ID", placeholder: "TRADE" },
    { advanced: true, key: "apiBaseUrl", label: "API base URL", placeholder: "https://demo.tradelocker.com/backend-api" },
    { advanced: true, key: "symbolMap", label: "Symbol map", placeholder: "EURUSD:EURUSD,XAUUSD:XAUUSD" },
    { advanced: true, key: "sizeMap", label: "Size map", placeholder: "EURUSD:0.1,XAUUSD:0.05" }
  ],
  mt5_bridge: [
    { key: "login", label: "MT5 username / login", placeholder: "318747699", required: true },
    { key: "password", label: "MT5 password", required: true, secret: true },
    { key: "server", label: "MT5 server", placeholder: "FTMO-Server", required: true },
    { advanced: true, key: "bridgeUrl", label: "Bridge URL", placeholder: "https://your-vps/place-order" },
    { advanced: true, key: "bridgeSecret", label: "Bridge secret", secret: true },
    { advanced: true, key: "accountId", label: "Account ID" },
    { advanced: true, key: "accountSize", label: "Account size", placeholder: "50000" },
    { advanced: true, key: "symbolMap", label: "Symbol map", placeholder: "EURUSD:EURUSD.,XAUUSD:XAUUSDm" },
    { advanced: true, key: "lotMap", label: "Lot map", placeholder: "EURUSD:0.1,XAUUSD:0.05" }
  ],
  ctrader: [
    { key: "accountId", label: "cTrader account ID", required: true },
    { key: "accessToken", label: "Access token", required: true, secret: true },
    { advanced: true, key: "refreshToken", label: "Refresh token", secret: true },
    { advanced: true, key: "accountSize", label: "Account size", placeholder: "50000" },
    { advanced: true, key: "bridgeUrl", label: "Bridge URL", placeholder: "https://your-ctrader-bridge/place-order" },
    { advanced: true, key: "bridgeSecret", label: "Bridge secret", secret: true },
    { advanced: true, key: "symbolMap", label: "Symbol map", placeholder: "EURUSD:1,XAUUSD:2" },
    { advanced: true, key: "sizeMap", label: "Size map", placeholder: "EURUSD:10000,XAUUSD:1" }
  ],
  matchtrader: [
    { key: "tradingApiToken", label: "Trading API token", required: true, secret: true },
    { advanced: true, key: "platformUrl", label: "Platform URL", placeholder: "https://platform.example.com" },
    { advanced: true, key: "systemUuid", label: "System UUID" },
    { advanced: true, key: "coAuthCookie", label: "co-auth cookie", secret: true },
    { advanced: true, key: "accountId", label: "Account ID" },
    { advanced: true, key: "accountSize", label: "Account size", placeholder: "50000" },
    { advanced: true, key: "symbolMap", label: "Symbol map", placeholder: "EURUSD:EURUSD,XAUUSD:GOLD" },
    { advanced: true, key: "sizeMap", label: "Size map", placeholder: "EURUSD:0.1,XAUUSD:0.05" }
  ],
  tradovate: [
    { key: "username", label: "Tradovate username", required: true },
    { key: "password", label: "Tradovate password", required: true, secret: true },
    { advanced: true, key: "accountId", label: "Account ID" },
    { advanced: true, key: "accountSpec", label: "Account spec" },
    { advanced: true, key: "accountSize", label: "Account size", placeholder: "50000" },
    { advanced: true, defaultValue: "TradingBot", key: "appId", label: "App ID", placeholder: "TradingBot" },
    { advanced: true, defaultValue: "1.0", key: "appVersion", label: "App version", placeholder: "1.0" },
    { advanced: true, key: "cid", label: "CID" },
    { advanced: true, key: "secret", label: "Secret", secret: true },
    { advanced: true, key: "apiBaseUrl", label: "API base URL", placeholder: "https://demo.tradovateapi.com/v1" },
    { advanced: true, key: "symbolMap", label: "Symbol map", placeholder: "ES:MESM6,NQ:MNQM6" },
    { advanced: true, key: "sizeMap", label: "Size map", placeholder: "ES:1,NQ:1" }
  ],
  rithmic: [
    { key: "login", label: "Rithmic user ID", placeholder: "LL000907", required: true },
    { key: "password", label: "Rithmic password", required: true, secret: true },
    { key: "accountId", label: "Rithmic account number", placeholder: "LL000907-003", required: true },
    { defaultValue: "Rithmic Paper Trading", key: "server", label: "System", placeholder: "Rithmic Paper Trading", required: true },
    { defaultValue: "Chicago", key: "gateway", label: "Gateway", placeholder: "Chicago", required: true },
    { advanced: true, key: "accountSize", label: "Account size", placeholder: "50000" },
    { advanced: true, key: "bridgeUrl", label: "Bridge URL", placeholder: "https://your-rithmic-bridge/place-order" },
    { advanced: true, key: "bridgeSecret", label: "Bridge secret", secret: true },
    { advanced: true, key: "symbolMap", label: "Symbol map", placeholder: "ES:MESM6,NQ:MNQM6" },
    { advanced: true, key: "sizeMap", label: "Size map", placeholder: "ES:1,NQ:1" }
  ]
};

function defaultConnectionFields(providerId: AutoTradeProviderId): Record<string, string> {
  return Object.fromEntries(
    (CONNECTION_FIELDS[providerId] ?? [])
      .filter((field) => field.defaultValue)
      .map((field) => [field.key, field.defaultValue!])
  );
}

function genericAccountName(fields: Record<string, string>, firm: PropFirmOption, provider: AutoTradeProvider): string {
  const account = fields.accountName || fields.accountId || fields.login || fields.username || fields.email || fields.accNum;
  return account ? `${firm.label} / ${account}` : `${firm.label} / ${provider.shortLabel}`;
}

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
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZoneName: "short"
  }).format(new Date(value));
}

function firstProviderId(providers: AutoTradeProvider[]): AutoTradeProviderId {
  return providers.find((provider) => autoTradeProviderFullyFunctioning(provider.id))?.id ?? providers[0]!.id;
}

function propFirmsForMarket(market: AutoTradeMarket): PropFirmOption[] {
  return PROP_FIRM_OPTIONS.filter((firm) => firm.markets.includes(market));
}

function firmHasFullyFunctioningPath(firm: PropFirmOption, providers: AutoTradeProvider[]): boolean {
  const marketProviderIds = new Set(providers.map((provider) => provider.id));
  return firm.platformIds.some((providerId) => marketProviderIds.has(providerId) && autoTradeProviderFullyFunctioning(providerId));
}

function firstPropFirmId(market: AutoTradeMarket): string {
  const firms = propFirmsForMarket(market);
  return firms.find((firm) => firmHasFullyFunctioningPath(firm, autoTradeProvidersForMarket(market)))?.id ?? firms[0]?.id ?? PROP_FIRM_OPTIONS[0]!.id;
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

function accountCountLabel(count: number): string {
  return `${count} account${count === 1 ? "" : "s"}`;
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
  const propFirms = useMemo(() => propFirmsForMarket(market), [market]);
  const [selectedFirmId, setSelectedFirmId] = useState(() => firstPropFirmId(market));
  const [selectedProviderId, setSelectedProviderId] = useState<AutoTradeProviderId>(() => firstProviderId(providers));
  const [userName, setUserName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [projectXAccessCode, setProjectXAccessCode] = useState("");
  const [genericAccessCode, setGenericAccessCode] = useState("");
  const [status, setStatus] = useState<ProjectXConnectionStatus>(EMPTY_STATUS);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [isChecking, setIsChecking] = useState(market === "futures");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isUpdatingPaused, setIsUpdatingPaused] = useState(false);
  const [isUnlockingFolder, setIsUnlockingFolder] = useState(false);
  const [accountMode, setAccountMode] = useState<AutoTradeAccountMode | null>(null);
  const [isAccountModeReady, setIsAccountModeReady] = useState(false);
  const [savedConnections, setSavedConnections] = useState<SavedAutoTradeConnection[]>([]);
  const [genericFields, setGenericFields] = useState<Record<string, string>>(() => defaultConnectionFields(selectedProviderId));
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const [activeProjectXFolderId, setActiveProjectXFolderId] = useState<string | null>(null);
  const [pendingProjectXFolder, setPendingProjectXFolder] = useState<ProjectXConnectionSummary | null>(null);
  const [folderCodeInput, setFolderCodeInput] = useState("");
  const [folderAccessError, setFolderAccessError] = useState("");
  const [unlockedProjectXFolderIds, setUnlockedProjectXFolderIds] = useState<string[]>([]);
  const [reconnectProjectXConnectionId, setReconnectProjectXConnectionId] = useState<string | null>(null);
  const folderCodeInputRef = useRef<HTMLInputElement | null>(null);

  const marketLabel = autoTradeMarketLabel(market);
  const selectedFirm = propFirms.find((firm) => firm.id === selectedFirmId) ?? propFirms[0]!;
  const platformOptions = selectedFirm.platformIds
    .map((providerId) => providers.find((provider) => provider.id === providerId))
    .filter((provider): provider is AutoTradeProvider => Boolean(provider));
  const selectedProvider = platformOptions.find((provider) => provider.id === selectedProviderId) ?? platformOptions[0] ?? providers[0]!;
  const selectedFirmReady = firmHasFullyFunctioningPath(selectedFirm, providers);
  const selectedProviderReady = autoTradeProviderFullyFunctioning(selectedProvider.id);
  const canConnectSelectedProvider = selectedProviderReady && selectedProvider.id === "projectx" && selectedProvider.status === "live" && market === "futures";
  const storageLabel = status.storageMode === "firebase" ? "Firebase" : "local dev storage";
  const displayUserName = status.userName || userName || "--";
  const visibleAccounts = market === "futures" ? status.accounts : [];
  const projectXAccountFolders = useMemo<ProjectXConnectionSummary[]>(
    () =>
      market === "futures"
        ? status.connections?.length
          ? status.connections
          : visibleAccounts.length
            ? [
                {
                  accounts: visibleAccounts,
                  autoTradePaused: status.autoTradePaused,
                  connectedAt: status.checkedAt ?? new Date(0).toISOString(),
                  id: `projectx-${displayUserName.toLowerCase()}`,
                  pausedAccountIds: status.pausedAccountIds,
                  readable: true,
                  status: "connected" as const,
                  updatedAt: status.checkedAt ?? new Date(0).toISOString(),
                  userName: displayUserName
                }
              ]
            : []
        : [],
    [displayUserName, market, status.autoTradePaused, status.checkedAt, status.connections, status.pausedAccountIds, visibleAccounts]
  );
  const visibleSavedConnections = savedConnections.filter((connection) => providers.some((provider) => provider.id === connection.id));
  const activeProjectXFolder = projectXAccountFolders.find((folder) => folder.id === activeProjectXFolderId);
  const selectedProviderFields = CONNECTION_FIELDS[selectedProvider.id] ?? [];
  const primaryProviderFields = selectedProviderFields.filter((field) => !field.advanced);
  const advancedProviderFields = selectedProviderFields.filter((field) => field.advanced);
  const canManageAutoTrade = Boolean(accountMode);

  useEffect(() => {
    function syncAccountMode() {
      const nextMode = savedAccountMode();
      setAccountMode(nextMode);
      if (!nextMode) {
        setIsAddingAccount(false);
        setReconnectProjectXConnectionId(null);
        setActiveProjectXFolderId(null);
        setPendingProjectXFolder(null);
        setFolderCodeInput("");
        setFolderAccessError("");
        setUnlockedProjectXFolderIds([]);
      }
    }

    syncAccountMode();
    setIsAccountModeReady(true);
    window.addEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
    return () => window.removeEventListener(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT, syncAccountMode);
  }, []);

  useEffect(() => {
    if (!propFirms.some((firm) => firm.id === selectedFirmId)) {
      setSelectedFirmId(firstPropFirmId(market));
    }
  }, [market, propFirms, selectedFirmId]);

  useEffect(() => {
    const nextFirm = propFirms.find((firm) => firm.id === selectedFirmId) ?? propFirms[0];
    const nextProviders = (nextFirm?.platformIds ?? [])
      .map((providerId) => providers.find((provider) => provider.id === providerId))
      .filter((provider): provider is AutoTradeProvider => Boolean(provider));
    if (!nextProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(firstProviderId(nextProviders.length ? nextProviders : providers));
    }
  }, [providers, propFirms, selectedFirmId, selectedProviderId]);

  useEffect(() => {
    setIsAddingAccount(false);
    setReconnectProjectXConnectionId(null);
    setActiveProjectXFolderId(null);
    setPendingProjectXFolder(null);
    setFolderCodeInput("");
    setFolderAccessError("");
    setUnlockedProjectXFolderIds([]);
    setProjectXAccessCode("");
    setGenericAccessCode("");
    setSelectedFirmId(firstPropFirmId(market));
    setGenericFields(defaultConnectionFields(firstProviderId(providers)));
    setShowAdvancedFields(false);
  }, [market]);

  useEffect(() => {
    if (activeProjectXFolderId && !projectXAccountFolders.some((folder) => folder.id === activeProjectXFolderId)) {
      setActiveProjectXFolderId(null);
    }
  }, [activeProjectXFolderId, projectXAccountFolders]);

  useEffect(() => {
    if (!pendingProjectXFolder || folderCodeInput.length !== FOLDER_UNLOCK_CODE_MAX_LENGTH || isUnlockingFolder) return;
    const frame = window.requestAnimationFrame(() => {
      void unlockProjectXFolder(folderCodeInput);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [folderCodeInput, isUnlockingFolder, pendingProjectXFolder]);

  useEffect(() => {
    setGenericFields(defaultConnectionFields(selectedProviderId));
    setShowAdvancedFields(false);
  }, [selectedProviderId]);

  useEffect(() => {
    if (!pendingProjectXFolder) return;
    const frame = window.requestAnimationFrame(() => folderCodeInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pendingProjectXFolder]);

  useEffect(() => {
    if (pendingProjectXFolder && !projectXAccountFolders.some((folder) => folder.id === pendingProjectXFolder.id)) {
      setPendingProjectXFolder(null);
      setFolderCodeInput("");
      setFolderAccessError("");
    }
  }, [pendingProjectXFolder, projectXAccountFolders]);

  function requestProjectXFolder(folder: ProjectXConnectionSummary) {
    if (unlockedProjectXFolderIds.includes(folder.id)) {
      setPendingProjectXFolder(null);
      setActiveProjectXFolderId(folder.id);
      return;
    }

    setActiveProjectXFolderId(null);
    setPendingProjectXFolder(folder);
    setFolderCodeInput("");
    setFolderAccessError("");
  }

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
          accessCode: projectXAccessCode,
          apiKey,
          connectionId: reconnectProjectXConnectionId,
          userName
        })
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
      setApiKey("");
      setProjectXAccessCode("");
      setReconnectProjectXConnectionId(null);
      setActiveProjectXFolderId(null);
      setPendingProjectXFolder(null);
      setUnlockedProjectXFolderIds([]);
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
    if (!selectedProviderReady) return;

    setIsConnecting(true);
    try {
      const response = await fetch("/api/auto-trading/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessCode: genericAccessCode,
          accountId: genericFields.accountId,
          accountName: genericAccountName(genericFields, selectedFirm, selectedProvider),
          firmId: selectedFirm.id,
          firmLabel: selectedFirm.label,
          fields: genericFields,
          providerId: selectedProvider.id
        })
      });
      const payload = await parseSavedConnections(response);
      setSavedConnections(payload.connections);
      setGenericFields(defaultConnectionFields(selectedProvider.id));
      setGenericAccessCode("");
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

  async function handleDisconnect(connectionId?: string) {
    setIsDisconnecting(true);
    try {
      const response = await fetch(connectionId ? `/api/topstep/connection?connectionId=${encodeURIComponent(connectionId)}` : "/api/topstep/connection", {
        method: "DELETE"
      });
      const nextStatus = await parseConnectionResponse(response);
      setStatus(nextStatus);
      setIsAddingAccount(false);
      setActiveProjectXFolderId(null);
      setPendingProjectXFolder(null);
      setUnlockedProjectXFolderIds((current) => (connectionId ? current.filter((id) => id !== connectionId) : []));
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

  async function handleAutoTradePaused(accountId: number, nextPaused: boolean, connectionId?: string) {
    setIsUpdatingPaused(true);
    try {
      const response = await fetch("/api/topstep/connection", {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          accountId,
          autoTradePaused: nextPaused,
          connectionId
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

  function handleProjectXReconnect(connectionId: string, login: string | undefined) {
    setReconnectProjectXConnectionId(connectionId);
    setSelectedFirmId("topstep");
    setSelectedProviderId("projectx");
    setUserName(login ?? "");
    setApiKey("");
    setProjectXAccessCode("");
    setActiveProjectXFolderId(null);
    setPendingProjectXFolder(null);
    setIsAddingAccount(true);
  }

  async function handleGenericPaused(providerId: AutoTradeProviderId, nextPaused: boolean) {
    if (!autoTradeProviderFullyFunctioning(providerId)) return;

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

  async function unlockProjectXFolder(code = folderCodeInput) {
    if (!pendingProjectXFolder) return;
    const accessCode = cleanAccessCode(code, FOLDER_UNLOCK_CODE_MAX_LENGTH);
    if (!accessCode || isUnlockingFolder) return;

    setIsUnlockingFolder(true);
    setFolderAccessError("");
    try {
      const response = await fetch("/api/auto-trading/access-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessCode,
          connectionId: pendingProjectXFolder.id,
          type: "projectx"
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Incorrect code.");
      }

      setUnlockedProjectXFolderIds((current) => (current.includes(pendingProjectXFolder.id) ? current : [...current, pendingProjectXFolder.id]));
      setActiveProjectXFolderId(pendingProjectXFolder.id);
      setPendingProjectXFolder(null);
      setFolderCodeInput("");
    } catch (error) {
      setFolderCodeInput("");
      setFolderAccessError(error instanceof Error ? error.message : "Incorrect code.");
      window.requestAnimationFrame(() => folderCodeInputRef.current?.focus());
    } finally {
      setIsUnlockingFolder(false);
    }
  }

  function handleUnlockProjectXFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void unlockProjectXFolder();
  }

  if (!isAccountModeReady) {
    return (
      <div className="topstepConnection">
        <div className="autoTradeGatePanel" />
      </div>
    );
  }

  if (!accountMode) {
    return (
      <div className="topstepConnection">
        <div className="topstepAccountEmpty autoTradeModeNotice">
          <strong>Choose account mode</strong>
          <span>Use the mode control above the market tabs to continue.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="topstepConnection">
      <div className="topstepConnectionActions topstepPrimaryActions">
        {isAddingAccount ? (
          <button type="button" onClick={() => {
            setReconnectProjectXConnectionId(null);
            setIsAddingAccount(false);
            setProjectXAccessCode("");
            setGenericAccessCode("");
          }}>
            Back to Accounts
          </button>
        ) : activeProjectXFolder ? (
          <>
            <button type="button" onClick={() => setActiveProjectXFolderId(null)}>
              Back to Folders
            </button>
            <button type="button" disabled={isChecking || isConnecting || market !== "futures"} onClick={() => refreshConnection()}>
              {isChecking ? "Checking..." : "Refresh"}
            </button>
          </>
        ) : pendingProjectXFolder ? (
          <button type="button" onClick={() => {
            setPendingProjectXFolder(null);
            setFolderCodeInput("");
            setFolderAccessError("");
          }}>
            Back to Folders
          </button>
        ) : (
          <>
            {canManageAutoTrade ? (
              <button type="button" onClick={() => setIsAddingAccount(true)}>
                Add Account
              </button>
            ) : null}
            <button type="button" disabled={isChecking || isConnecting || market !== "futures"} onClick={() => refreshConnection()}>
              {isChecking ? "Checking..." : "Refresh"}
            </button>
          </>
        )}
      </div>

      {isAddingAccount ? (
        <div className="autoTradeAddAccount">
          <div className="autoTradeSelectGrid">
            <label className="autoTradeSelectControl">
              <span>Prop firm</span>
              <select className={selectedFirmReady ? undefined : "is-muted"} value={selectedFirm.id} onChange={(event) => setSelectedFirmId(event.target.value)}>
                {propFirms.map((firm) => {
                  const isReady = firmHasFullyFunctioningPath(firm, providers);
                  return (
                    <option disabled={!isReady} key={firm.id} value={firm.id}>
                      {isReady ? firm.label : `${firm.label} - limited`}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="autoTradeSelectControl">
              <span>Platform</span>
              <select className={selectedProviderReady ? undefined : "is-muted"} value={selectedProvider.id} onChange={(event) => setSelectedProviderId(event.target.value as AutoTradeProviderId)}>
                {platformOptions.map((provider) => {
                  const isReady = autoTradeProviderFullyFunctioning(provider.id);
                  return (
                    <option disabled={!isReady} key={provider.id} value={provider.id}>
                      {isReady ? provider.shortLabel : `${provider.shortLabel} - limited`}
                    </option>
                  );
                })}
              </select>
            </label>
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
              <label>
                <span>Folder code</span>
                <input
                  autoComplete="new-password"
                  inputMode="numeric"
                  maxLength={ACCESS_CODE_MAX_LENGTH}
                  name="projectx-folder-code"
                  onChange={(event) => setProjectXAccessCode(cleanAccessCode(event.target.value))}
                  pattern="[0-9]{4,12}"
                  placeholder="4-12 digits"
                  required
                  type="password"
                  value={projectXAccessCode}
                />
              </label>
              <button type="submit" disabled={isConnecting}>
                {isConnecting ? "Connecting..." : reconnectProjectXConnectionId ? "Reconnect" : "Connect Account"}
              </button>
            </form>
          ) : selectedProviderReady && selectedProviderFields.length ? (
            <form className="topstepConnectForm" onSubmit={handleGenericConnect}>
              {[...primaryProviderFields, ...(showAdvancedFields ? advancedProviderFields : [])].map((field) => (
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
              <label>
                <span>Account code</span>
                <input
                  autoComplete="new-password"
                  inputMode="numeric"
                  maxLength={ACCESS_CODE_MAX_LENGTH}
                  name={`${selectedProvider.id}-account-code`}
                  onChange={(event) => setGenericAccessCode(cleanAccessCode(event.target.value))}
                  pattern="[0-9]{4,12}"
                  placeholder="4-12 digits"
                  required
                  type="password"
                  value={genericAccessCode}
                />
              </label>
              {advancedProviderFields.length ? (
                <button type="button" onClick={() => setShowAdvancedFields((current) => !current)}>
                  {showAdvancedFields ? "Hide Advanced" : "Advanced Settings"}
                </button>
              ) : null}
              <button type="submit" disabled={isConnecting}>
                {isConnecting ? "Connecting..." : "Connect Account"}
              </button>
            </form>
          ) : (
            <div className="topstepAccountEmpty autoTradeUnavailable">
              <strong>{selectedProvider.label} is not fully functioning yet</strong>
              <span>Only ProjectX / TopstepX is enabled for production auto-trading right now.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="topstepAccountList" aria-live="polite">
          {visibleAccounts.length === 0 && visibleSavedConnections.length === 0 ? (
            <div className="topstepAccountEmpty">
              <strong>No {marketLabel.toLowerCase()} auto-trade accounts connected</strong>
              <span>
                {canManageAutoTrade
                  ? `Use Add Account to pick a ${marketLabel.toLowerCase()} connector. Accounts from the other market stay hidden here.`
                  : "Choose account mode to add accounts. Accounts from the other market stay hidden here."}
              </span>
            </div>
          ) : pendingProjectXFolder ? (
            <form className="autoTradeFolderGate" onClick={() => folderCodeInputRef.current?.focus()} onSubmit={handleUnlockProjectXFolder}>
              <div>
                <span>Locked folder</span>
                <strong>{pendingProjectXFolder.userName ?? "ProjectX account"}</strong>
              </div>
              <div className="autoTradeFolderPinField">
                <span>Folder code</span>
                <input
                  autoFocus
                  className="autoTradePinHidden"
                  autoComplete="current-password"
                  inputMode="numeric"
                  maxLength={FOLDER_UNLOCK_CODE_MAX_LENGTH}
                  onChange={(event) => {
                    const nextValue = cleanAccessCode(event.target.value, FOLDER_UNLOCK_CODE_MAX_LENGTH);
                    setFolderCodeInput(nextValue);
                    setFolderAccessError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && folderCodeInput.length === 0) {
                      setPendingProjectXFolder(null);
                      setFolderAccessError("");
                    }
                  }}
                  pattern="[0-9]*"
                  ref={folderCodeInputRef}
                  required
                  type="password"
                  value={folderCodeInput}
                />
                <div className="autoTradePinGrid autoTradeCompactPinGrid" aria-hidden>
                  {Array.from({ length: FOLDER_UNLOCK_CODE_MAX_LENGTH }, (_, index) => {
                    const digit = folderCodeInput[index] ?? "";
                    const isActiveSlot = folderCodeInput.length === index && folderCodeInput.length < FOLDER_UNLOCK_CODE_MAX_LENGTH;
                    return (
                      <span
                        className={`autoTradePinBox${digit ? " filled" : ""}${isActiveSlot ? " active" : ""}`}
                        key={`projectx-folder-pin-${index + 1}`}
                      >
                        {digit}
                      </span>
                    );
                  })}
                </div>
              </div>
              {folderAccessError ? <small>{folderAccessError}</small> : null}
            </form>
          ) : activeProjectXFolder ? (
            <div className="topstepAccountFolderPage">
              <div className="topstepFolderPageHead">
                <div>
                  <span>Login</span>
                  <strong>{activeProjectXFolder.userName ?? "--"}</strong>
                </div>
                <div>
                  <span>Provider</span>
                  <strong>ProjectX</strong>
                </div>
                <div>
                  <span>Platform</span>
                  <strong>TopstepX / Futures</strong>
                </div>
                <div>
                  <span>Accounts</span>
                  <strong>{accountCountLabel(activeProjectXFolder.accounts.length)}</strong>
                </div>
              </div>
              <div className="topstepFolderAccounts">
                {activeProjectXFolder.accounts.map((account) => {
                  const folderPausedAccountIds = new Set(activeProjectXFolder.pausedAccountIds ?? activeProjectXFolder.accounts.map((item) => item.id));
                  const accountPaused = folderPausedAccountIds.has(account.id);
                  const connectionStatus = activeProjectXFolder.readable
                    ? accountConnectionStatus(account, accountPaused)
                    : { className: "status failed", dotClassName: "statusDot red", label: "Disconnected" };
                  return (
                    <div className="topstepAccountRow isNested" key={`projectx-${account.id}`}>
                      <div className="topstepAccountFields">
                        <div>
                          <span>Account number</span>
                          <strong>{account.id}</strong>
                        </div>
                        <div>
                          <span>Account name</span>
                          <strong>{account.name}</strong>
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
                      {canManageAutoTrade ? (
                        <div className="topstepAccountControls">
                          <button
                            className={accountPaused ? "playButton" : "pauseButton"}
                            type="button"
                            disabled={isUpdatingPaused || isDisconnecting}
                            onClick={() =>
                              activeProjectXFolder.readable
                                ? handleAutoTradePaused(account.id, !accountPaused, activeProjectXFolder.id)
                                : handleProjectXReconnect(activeProjectXFolder.id, activeProjectXFolder.userName)
                            }
                          >
                            {isUpdatingPaused ? "Updating..." : activeProjectXFolder.readable ? (accountPaused ? "Play" : "Pause") : "Reconnect"}
                          </button>
                          <button className="dangerButton" type="button" disabled={isDisconnecting} onClick={() => handleDisconnect(activeProjectXFolder.id)}>
                            {isDisconnecting ? "Removing..." : "Remove"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {projectXAccountFolders.map((folder) => (
                <button className="topstepAccountFolderButton" key={folder.id} onClick={() => requestProjectXFolder(folder)} type="button">
                  <span className="topstepFolderIcon" aria-hidden="true" />
                  <div className="topstepFolderIdentity">
                    <span>Login</span>
                    <strong>{folder.userName ?? "--"}</strong>
                  </div>
                  <div className="topstepFolderMeta provider">
                    <span>Provider</span>
                    <strong>ProjectX</strong>
                  </div>
                  <div className="topstepFolderMeta platform">
                    <span>Platform</span>
                    <strong>TopstepX / Futures</strong>
                  </div>
                  <div className="topstepFolderCount">
                    <strong>{accountCountLabel(folder.accounts.length)}</strong>
                  </div>
                </button>
              ))}
              {visibleSavedConnections.map((connection) => {
                const provider = providers.find((item) => item.id === connection.id);
                const connectionReady = autoTradeProviderFullyFunctioning(connection.id);
                return (
                  <div className={`topstepAccountRow${connectionReady ? "" : " autoTradeDisabledRow"}`} key={connection.id}>
                    <div className="topstepAccountFields">
                      <div>
                        <span>Firm</span>
                        <strong>{connection.firmLabel ?? "--"}</strong>
                      </div>
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
                        <strong className={`topstepStatusValue status ${connectionReady ? (connection.paused ? "skipped" : "sent") : "skipped"}`}>
                          <span aria-hidden="true" className={connectionReady ? (connection.paused ? "statusDot orange" : "statusDot green") : "statusDot gray"} />
                          {connectionReady ? (connection.paused ? "Paused" : "Connected") : "Limited"}
                        </strong>
                      </div>
                    </div>
                    {canManageAutoTrade ? (
                      <div className="topstepAccountControls">
                        <button
                          className={connection.paused ? "playButton" : "pauseButton"}
                          type="button"
                          disabled={isUpdatingPaused || isDisconnecting || !connectionReady}
                          onClick={() => handleGenericPaused(connection.id, !connection.paused)}
                        >
                          {isUpdatingPaused ? "Updating..." : connection.paused ? "Play" : "Pause"}
                        </button>
                        <button className="dangerButton" type="button" disabled={isDisconnecting} onClick={() => handleGenericDisconnect(connection.id)}>
                          {isDisconnecting ? "Removing..." : "Remove"}
                        </button>
                      </div>
                    ) : null}
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
