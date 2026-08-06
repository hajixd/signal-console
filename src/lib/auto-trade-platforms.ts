export type AutoTradeMarket = "forex" | "futures";

export type AutoTradeProviderId =
  | "projectx"
  | "tradelocker"
  | "mt5_bridge"
  | "mt5_ea"
  | "ctrader"
  | "matchtrader"
  | "tradovate"
  | "rithmic";

export type AutoTradeProviderStatus = "live" | "adapter_ready" | "planned";

export type AutoTradeProvider = {
  id: AutoTradeProviderId;
  label: string;
  shortLabel: string;
  markets: AutoTradeMarket[];
  status: AutoTradeProviderStatus;
  statusLabel: string;
  coverage: string;
  connectionMode: string;
  description: string;
};

export const AUTO_TRADE_PROVIDERS: AutoTradeProvider[] = [
  {
    id: "projectx",
    label: "ProjectX",
    shortLabel: "ProjectX",
    markets: ["futures"],
    status: "live",
    statusLabel: "Live",
    coverage: "TopstepX and ProjectX-backed futures accounts.",
    connectionMode: "API key",
    description: "Direct ProjectX API execution with per-account pause controls and bracket orders."
  },
  {
    id: "tradovate",
    label: "Tradovate / CQG",
    shortLabel: "Tradovate",
    markets: ["futures"],
    status: "adapter_ready",
    statusLabel: "Limited",
    coverage: "Lucid CQG, NinjaTrader, Tradovate, and TradingView futures routes.",
    connectionMode: "OAuth or bridge",
    description: "Best futures expansion path for CQG-based prop accounts once credentials are available."
  },
  {
    id: "rithmic",
    label: "Rithmic Bridge",
    shortLabel: "Rithmic",
    markets: ["futures"],
    status: "adapter_ready",
    statusLabel: "Bridge required",
    coverage: "Lucid Rithmic, Quantower, MotiveWave, Sierra Chart, R|Trader Pro, and related futures platforms.",
    connectionMode: "Desktop or VPS bridge",
    description: "Bridge adapter for Rithmic accounts where direct broker API access is not exposed."
  },
  {
    id: "tradelocker",
    label: "TradeLocker",
    shortLabel: "TradeLocker",
    markets: ["forex"],
    status: "adapter_ready",
    statusLabel: "Limited",
    coverage: "E8 US, Blue Guardian, FunderPro, and other TradeLocker prop accounts.",
    connectionMode: "REST API",
    description: "Direct API route using the email, password, and server issued with a TradeLocker account."
  },
  {
    id: "mt5_ea",
    label: "MetaTrader 5",
    shortLabel: "MT5",
    markets: ["forex"],
    status: "live",
    statusLabel: "Live",
    coverage: "FTMO and other MT5 prop-firm accounts connected through the secure Windows execution service.",
    connectionMode: "MT5 trading credentials",
    description: "Connect the login, master trading password, and exact broker server issued with the prop-firm account."
  },
  {
    id: "ctrader",
    label: "cTrader",
    shortLabel: "cTrader",
    markets: ["forex"],
    status: "adapter_ready",
    statusLabel: "Bridge required",
    coverage: "FTMO, The5ers, E8, FundedNext, BrightFunded, and other cTrader prop accounts where Open API access is available.",
    connectionMode: "Open API token",
    description: "cTrader account routing with account ID and OAuth token while bridge/client credentials stay advanced."
  },
  {
    id: "matchtrader",
    label: "Match-Trader",
    shortLabel: "MatchTrader",
    markets: ["forex"],
    status: "adapter_ready",
    statusLabel: "Limited",
    coverage: "E8 US, FundedNext US, Blue Guardian, FundingPips, and other Match-Trader prop accounts with API access enabled.",
    connectionMode: "Trading API token",
    description: "Match-Trader API route for accounts where the firm exposes a trading API token."
  }
];

export const FULLY_FUNCTIONING_AUTO_TRADE_PROVIDER_IDS: ReadonlySet<AutoTradeProviderId> = new Set<AutoTradeProviderId>([
  "projectx",
  "mt5_ea"
]);

export function autoTradeProviderFullyFunctioning(providerId: AutoTradeProviderId): boolean {
  return FULLY_FUNCTIONING_AUTO_TRADE_PROVIDER_IDS.has(providerId);
}

export function autoTradeProvidersForMarket(market: AutoTradeMarket): AutoTradeProvider[] {
  return AUTO_TRADE_PROVIDERS.filter((provider) => provider.markets.includes(market));
}

export function autoTradeProviderById(providerId: AutoTradeProviderId): AutoTradeProvider | undefined {
  return AUTO_TRADE_PROVIDERS.find((provider) => provider.id === providerId);
}

export function autoTradeMarketLabel(market: AutoTradeMarket): string {
  return market === "futures" ? "Futures" : "Forex";
}

export function autoTradeMarketForSignal(market: string): AutoTradeMarket | null {
  if (market === "futures") return "futures";
  if (market === "forex" || market === "gold_spot") return "forex";
  return null;
}
