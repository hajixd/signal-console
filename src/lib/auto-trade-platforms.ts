export type AutoTradeMarket = "forex" | "futures";

export type AutoTradeProviderId =
  | "projectx"
  | "tradelocker"
  | "mt5_bridge"
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
    status: "live",
    statusLabel: "Live",
    coverage: "Lucid CQG, NinjaTrader, Tradovate, and TradingView futures routes.",
    connectionMode: "OAuth or bridge",
    description: "Best futures expansion path for CQG-based prop accounts once credentials are available."
  },
  {
    id: "rithmic",
    label: "Rithmic Bridge",
    shortLabel: "Rithmic",
    markets: ["futures"],
    status: "live",
    statusLabel: "Live",
    coverage: "Lucid Rithmic, Quantower, MotiveWave, Sierra Chart, R|Trader Pro, and related futures platforms.",
    connectionMode: "Desktop or VPS bridge",
    description: "Bridge adapter for Rithmic accounts where direct broker API access is not exposed."
  },
  {
    id: "tradelocker",
    label: "TradeLocker",
    shortLabel: "TradeLocker",
    markets: ["forex"],
    status: "live",
    statusLabel: "Live",
    coverage: "E8 US Forex/CFD and other TradeLocker prop accounts.",
    connectionMode: "REST API",
    description: "Primary direct API route for Forex/CFD prop firms that expose TradeLocker credentials."
  },
  {
    id: "mt5_bridge",
    label: "MetaTrader 5 Bridge",
    shortLabel: "MT5",
    markets: ["forex"],
    status: "live",
    statusLabel: "Live",
    coverage: "FTMO MT5 and MT5-based prop accounts through a VPS Expert Advisor.",
    connectionMode: "Windows VPS EA",
    description: "MT5 Expert Advisor bridge pattern for accounts that require terminal-based execution."
  },
  {
    id: "ctrader",
    label: "cTrader",
    shortLabel: "cTrader",
    markets: ["forex"],
    status: "live",
    statusLabel: "Live",
    coverage: "FTMO and other cTrader prop accounts where Open API access is available.",
    connectionMode: "Open API",
    description: "Direct cTrader Open API connector for C# or token-based automation setups."
  },
  {
    id: "matchtrader",
    label: "Match-Trader",
    shortLabel: "MatchTrader",
    markets: ["forex"],
    status: "live",
    statusLabel: "Live",
    coverage: "E8 US accounts that choose MatchTrader when broker API access is enabled.",
    connectionMode: "Broker API",
    description: "Connector slot for firms that enable Match-Trader platform API access."
  }
];

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
