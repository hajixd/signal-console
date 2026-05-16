# Potential Strategies

This folder is intentionally isolated from the live strategy catalog.

Nothing in here is imported by `src/lib/strategy-loader.ts`, and nothing here is
read by the normal Python backtest runner. Treat it as a research lab for ideas
that may later be promoted into `strategy/` only after review.

## Strategy Provenance Labels

- `research_derived`: new logic built from a paper or institutional market
  structure claim.
- `session_specific`: a rule built around a recurring session window such as
  overnight, London open, NY open, or the last half hour.
- `cross_asset_transfer`: existing strategy logic applied to a new asset. Useful,
  but not counted as a genuinely new research idea unless explicitly marked.

## Current Focus

The first isolated scan emphasizes research-derived and session-specific ideas:

- Overnight vs regular-hours return effects.
- First-half-hour to last-half-hour intraday momentum.
- Overnight gap fade/continuation effects.
- London open momentum and Asia-range breakout behavior for FX.
- Time-series momentum ideas inspired by futures literature.

Run from the repo root:

```powershell
python ".\Potential Strategies\research_backtester.py" --write --limit 20
```

Outputs:

- `Potential Strategies/results/qualified_strategies.csv`
- `Potential Strategies/<strategy_id>/strategy.json`
- `Potential Strategies/<strategy_id>/backtest_trades.csv`
- `Potential Strategies/<strategy_id>/research.md`
