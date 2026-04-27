# HG Tori Trades Trendline Break Retest

## Public Strategy Interpretation

This strategy adapts Tori's trendline break framework into the repo's multi-timeframe trendline runtime. The selected copper futures variant kept the same core lookback and touch-count logic as the existing gold versions, then leaned into a slightly higher reward multiple that improved local copper performance without collapsing trade count.

## Sources

- https://www.fxreplay.com/strategies/tori-trades-trendlines-strategy
- https://www.tradezella.com/strategies/trendline-strategy

## Test Protocol

- Candidate variants were searched locally on the repo's shared 15m HG dataset.
- The final `backtest_trades.csv` was generated in fast mode in this workspace after the full strict run timed out on the full history.
- A bounded `audit-anti-cheat --tail-bars 1500` pass was completed for this strategy before keeping it.
- Costs are set to `0.0` units for this strategy.
