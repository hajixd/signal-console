# XAUUSD Tori Trades Trendline Break Retest

This strategy uses the same multi-timeframe Tori proxy as the gold futures variant:

- Prior completed daily candles set the directional bias.
- Hourly candles build the action line and safety line.
- Entries happen on the next 15-minute bar after an hourly break confirms.
- Stops trail behind confirmed hourly swing pivots.
- Targets stay anchored to visible structure rather than a fixed static ATR multiple.

Source set:

- https://toritradez.com/blog/all/perfect-trade-trend-line-setup
- https://toritradez.com/blog/all/trend-line-trading-masterclass-a-to-z
- https://toritradez.com/blog/all/low-risk-trend-line-trading-break-retest-bounce
- https://www.tradezella.com/strategies/trendline-strategy
- https://fxreplay.com/strategies/tori-trades-trendlines-strategy

The backtest metrics in this README are refreshed from the generated `backtest_trades.csv`.

Current integrated result from `2022-01-01` forward:

- Profit factor: `2.5365`
- Trades: `54`
- Total R: `31.15`

Validation note:

- The strategy was regenerated with the fast execution path and then checked with the anti-cheat audit on the most recent `8,000` 15-minute bars, where it passed with no trade drift.
