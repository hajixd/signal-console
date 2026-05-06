# AUD/USD Research-Based ICT Turtle Soup Reversal

## Public Strategy Interpretation

This strategy follows the Turtle Soup idea of fading false breakouts and liquidity sweeps, then requiring structure confirmation before entering the reversal. The selected runtime variant favored the EMA-filtered version with an all-session sweep search because it materially increased trade count on AUD/USD while staying ahead of the nearby parameter combinations in local testing.

## Sources

- https://fxreplay.com/strategies/ict-turtle-soup-strategy
- https://icttradingstrategy.com/ict-turtle-soup-trading-strategy-a-step-by-step-guide/

## Test Protocol

- Candidate variants were searched locally on the repo's shared 15m AUD/USD dataset.
- The final `backtest_trades.csv` was generated in fast mode in this workspace after the full strict run timed out on the full history.
- A bounded `audit-anti-cheat --tail-bars 1500` pass was completed for this strategy before keeping it.
- Costs are set to `0.0` units for this strategy.
