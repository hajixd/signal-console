export type KnownTraderStrategy = {
  trader: string;
  symbol: string;
  phase: string;
  variantId: string;
  statsPath: string;
  tradesPath: string;
  label: string;
};

export const KNOWN_TRADER_STRATEGIES: KnownTraderStrategy[] = [
  {
    trader: "Steven Dux",
    symbol: "CL",
    phase: "steven_dux_parabolic_fade",
    variantId: "steven_dux_parabolic_fade|ny|range=15|entry=150|rr=1|sl_atr=1|tp_atr=1.5|threshold=2.75|adx_max=none|adx_min=none|rsi2=none|trend=short_only|max_bars=10|one_trade=1",
    statsPath: "data/strategy-results/known_trader_fast_pass_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_fast_pass_quick_trades.csv",
    label: "CL Steven Dux Parabolic Short Fade"
  },
  {
    trader: "Humbled Trader",
    symbol: "CL",
    phase: "humbled_trader_vwap_reclaim",
    variantId: "humbled_trader_vwap_reclaim|ny|range=15|entry=150|rr=1.5|sl_atr=1|tp_atr=1.5|threshold=0.75|adx_max=none|adx_min=none|rsi2=none|trend=all|max_bars=16|one_trade=1",
    statsPath: "data/strategy-results/known_trader_fast_pass_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_fast_pass_quick_trades.csv",
    label: "CL Humbled Trader VWAP Reclaim Breakout"
  },
  {
    trader: "Mike Bellafiore",
    symbol: "NQ",
    phase: "mike_bellafiore_opening_drive",
    variantId: "mike_bellafiore_opening_drive|ny|range=15|entry=150|rr=1.5|sl_atr=1|tp_atr=1.5|threshold=0.45|adx_max=none|adx_min=none|rsi2=none|trend=ema|max_bars=16",
    statsPath: "data/strategy-results/known_trader_strategy_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_strategy_quick_trades.csv",
    label: "NQ Mike Bellafiore Opening Drive Momentum"
  },
  {
    trader: "Dan McDermitt",
    symbol: "GC",
    phase: "dan_mcdermitt_ema_rider",
    variantId: "dan_mcdermitt_ema_rider|ny|range=15|entry=150|rr=1.5|sl_atr=1|tp_atr=1.5|threshold=0.05|adx_max=none|adx_min=none|rsi2=none|trend=both|max_bars=32",
    statsPath: "data/strategy-results/known_trader_strategy_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_strategy_quick_trades.csv",
    label: "GC Dan McDermitt EMA Rider Pullback"
  },
  {
    trader: "Rayner Teo",
    symbol: "NQ",
    phase: "rayner_teo_first_pullback",
    variantId: "rayner_teo_first_pullback|ny|range=15|entry=150|rr=1.5|sl_atr=1|tp_atr=1.5|threshold=0.15|adx_max=none|adx_min=none|rsi2=none|trend=both|max_bars=40",
    statsPath: "data/strategy-results/known_trader_strategy_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_strategy_quick_trades.csv",
    label: "NQ Rayner Teo First Pullback Continuation"
  },
  {
    trader: "Umar Ashraf",
    symbol: "YM",
    phase: "umar_ashraf_opening_range_breakout",
    variantId: "umar_ashraf_opening_range_breakout|ny|range=15|entry=150|rr=1.5|sl_atr=1|tp_atr=1.5|threshold=0.4|adx_max=none|adx_min=none|rsi2=none|trend=ema|max_bars=16|one_trade=0",
    statsPath: "data/strategy-results/known_trader_fast_pass_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_fast_pass_quick_trades.csv",
    label: "YM Umar Ashraf Opening Range Breakout"
  },
  {
    trader: "Ricky Gutierrez",
    symbol: "YM",
    phase: "ricky_gutierrez_breakout_pullback",
    variantId: "ricky_gutierrez_breakout_pullback|ny|range=48|entry=150|rr=1.5|sl_atr=1|tp_atr=1.5|threshold=0.12|adx_max=none|adx_min=none|rsi2=none|trend=both|max_bars=20|one_trade=0",
    statsPath: "data/strategy-results/known_trader_fast_pass_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_fast_pass_quick_trades.csv",
    label: "YM Ricky Gutierrez Breakout Pullback"
  },
  {
    trader: "ClayTrader",
    symbol: "RTY",
    phase: "claytrader_sr_rejection",
    variantId: "claytrader_sr_rejection|ny|range=15|entry=150|rr=1.5|sl_atr=1|tp_atr=1.5|threshold=0.05|adx_max=none|adx_min=none|rsi2=none|trend=all|max_bars=16",
    statsPath: "data/strategy-results/known_trader_strategy_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_strategy_quick_trades.csv",
    label: "RTY ClayTrader Support Resistance Rejection"
  },
  {
    trader: "Sasha Evdakov",
    symbol: "YM",
    phase: "sasha_evdakov_fib_retrace",
    variantId: "sasha_evdakov_fib_retrace|ny|range=96|entry=150|rr=1.5|sl_atr=1|tp_atr=1.5|threshold=0.05|adx_max=none|adx_min=none|rsi2=none|trend=both|max_bars=28|one_trade=0",
    statsPath: "data/strategy-results/known_trader_fast_pass_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_fast_pass_quick_trades.csv",
    label: "YM Sasha Evdakov Fibonacci Retracement"
  },
  {
    trader: "Tori Trades",
    symbol: "SI",
    phase: "tori_trendline_break",
    variantId: "tori_trendline_break|ny|range=192|entry=150|rr=1.5|sl_atr=1|tp_atr=1.5|threshold=0.6|adx_max=none|adx_min=none|rsi2=none|trend=all|max_bars=32",
    statsPath: "data/strategy-results/known_trader_strategy_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_strategy_quick_trades.csv",
    label: "SI Tori Trades Trendline Break"
  },
  {
    trader: "TJR",
    symbol: "RTY",
    phase: "tjr_sweep_retrace",
    variantId: "tjr_sweep_retrace|ny|range=15|entry=150|rr=2|sl_atr=1|tp_atr=1.5|threshold=0.05|adx_max=none|adx_min=none|rsi2=none|trend=all|max_bars=24|one_trade=1",
    statsPath: "data/strategy-results/known_trader_fast_pass_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_fast_pass_quick_trades.csv",
    label: "RTY TJR Liquidity Sweep Retrace"
  },
  {
    trader: "Ross Cameron",
    symbol: "NQ",
    phase: "ross_cameron_gap_go",
    variantId: "ross_cameron_gap_go|ny|range=15|entry=150|rr=1.5|sl_atr=1|tp_atr=1.5|threshold=0.65|adx_max=none|adx_min=none|rsi2=none|trend=ema|max_bars=14",
    statsPath: "data/strategy-results/known_trader_strategy_quick_best_by_asset_strategy.csv",
    tradesPath: "data/strategy-results/known_trader_strategy_quick_trades.csv",
    label: "NQ Ross Cameron Gap and Go"
  }
];

export function knownTraderKey(strategy: Pick<KnownTraderStrategy, "symbol" | "phase">): string {
  return `${strategy.symbol}:${strategy.phase}`;
}

export function knownTraderSelectionKey(strategy: Pick<KnownTraderStrategy, "symbol" | "phase" | "variantId">): string {
  return `${strategy.symbol}\t${strategy.phase}\t${strategy.variantId}`;
}

export const KNOWN_TRADER_LABELS: Record<string, string> = Object.fromEntries(
  KNOWN_TRADER_STRATEGIES.map((strategy) => [knownTraderKey(strategy), strategy.label])
);
