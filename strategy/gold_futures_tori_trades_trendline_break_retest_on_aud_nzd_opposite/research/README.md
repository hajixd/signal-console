# GC Tori Trades Trendline Break Retest

This version is a top-down proxy of Tori Trades' public trendline workflow:

- Prior completed daily candles define the macro bias.
- Hourly candles define the action line and safety line.
- The bot enters on the next 15-minute bar after an hourly break confirms.
- Stops trail behind confirmed hourly swing pivots as new structure forms.
- Targets are anchored to the first historical structure level that still offers at least 2R.

Public material that informed the implementation:

- Tori Tradez, "What a Perfect Trade Looks Like: How to Identify High-Probability Trend Line Setups" (October 26, 2025)
- Tori Tradez, "Trend Line Trading Masterclass: A Complete A-to-Z Guide to Structure, Entries, and Risk Management" (November 2, 2025)
- Tori Tradez, "Low-Risk Trend Line Trading: How to Trade Breaks, Retests, and Bounces With Structure" (December 7, 2025)
- TradeZella, "Tori's Trendline Trading Strategy"
- FX Replay, "Tori Trades Trend Line Strategy" (April 4, 2025)

The backtest metrics in this README are refreshed from the generated `backtest_trades.csv`.

Current integrated result from `2022-01-01` forward:

- Profit factor: `2.7159`
- Trades: `63`
- Total R: `32.90`

Validation note:

- The strategy was regenerated with the fast execution path and then checked with the anti-cheat audit on the most recent `8,000` 15-minute bars, where it passed with no trade drift.
