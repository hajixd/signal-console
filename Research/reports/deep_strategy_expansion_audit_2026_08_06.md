# Deep Strategy Expansion Audit — 2026-08-06

## Objective

Increase independent Forex and Futures trade frequency without lowering the deployed portfolio requirements:

- development profit factor at least 3.0;
- full-history profit factor at least 3.0;
- sealed 2025–2026 holdout profit factor at least 3.0;
- positive performance in every tested calendar year;
- strict anti-lookahead replay and, where applicable, one-minute stop/target execution;
- no synthetic history rows or post-selection rewriting of trade outcomes.

## New research completed

| Search | Candidate trials | Result |
| --- | ---: | --- |
| Cross-market reward/risk transfer over 120 source rows, both directions and five RR brackets | 1,200 | 80 robust and 139 qualified-watch results; the strongest useful families were already represented in the registered catalog. |
| Strict novel-family scan over 10 Futures assets and 240 proven specifications | 2,400 | No new non-overlapping candidate passed the predefined stability gates. |
| New weekday/side regime-hole scan over 10 Futures assets | 2,400 | No candidate passed. |
| New weekday/side regime-hole scan over 13 Forex assets | 3,120 | No candidate passed. |
| Nested walk-forward search over EURUSD, GBPUSD, USDJPY, AUDUSD and EURJPY on 15m/1h | 2,800 | No validation finalist; sealed holdout was not opened for rejected candidates. |
| Nested walk-forward search over ES, NQ, YM, CL and GC on 15m/1h | 2,800 | No validation finalist; sealed holdout was not opened for rejected candidates. |

Total additional candidate trials: **14,720**.

The nested search included the engine's VWAP pullback, EMA pullback, moving-average crossover/touch, support/resistance retest, trendline break, liquidity-sweep, percentile-range, round-number rejection and related mean-reversion families. It used frozen early-window grids, a separate validation window, a limited sealed-holdout finalist budget, Benjamini–Hochberg false-discovery correction, exact strategy costs and one-minute execution parity.

Existing ML research was also reviewed. Logistic regression, Extra Trees, histogram gradient boosting and XGBoost sizing models had already been tested with purged expanding out-of-fold windows and bounded 0.5x–1.5x sizing. None had enough eligible sealed-holdout evidence, so no ML model was promoted.

## Research inputs

Ideas were treated as hypotheses rather than evidence. The main research inputs included:

- Baltussen, Da, Lammers and Martens, *Hedging Demand and Market Intraday Momentum*: https://repub.eur.nl/pub/131621
- Moskowitz, Ooi and Pedersen, *Time Series Momentum*: https://pages.stern.nyu.edu/~lpederse/papers/TimeSeriesMomentum.pdf
- Bailey and Lopez de Prado, *The Deflated Sharpe Ratio*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551
- da Costa and Gebbie, *Learning low-frequency temporal patterns for quantitative trading*: https://arxiv.org/abs/2008.09481
- Kaggle regime/ML examples and Reddit discussions already recorded in `nested_ml_session_sizing_*_summary.json`.

## Exact live maximum after the expansion search

The all-strategy MILP optimizer examined all 77 Forex and 73 Futures registered candidates after the research pass. It maximized completed trade count subject to the unchanged aggregate constraints.

| Market | Strategies | Full trades | Full PF | Active trading-day frequency | Calendar-day frequency | Sealed holdout PF | Worst full-year PF |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Forex | 18 | 1,289 | 3.011432 | 2.436673 | 0.799638 | 3.014296 | 2.035097 |
| Futures | 12 | 656 | 3.002341 | 1.392781 | 0.405695 | 3.005572 | 2.365983 |

This is the exact maximum frequency attainable from the completed, registered catalog under the stated PF/holdout/year constraints. The requested five trades per calendar day is not supported by the available validated history. Lowering gates repeatedly after observing failures would turn the search itself into overfitting, so the predefined gates were not relaxed again.

Historical and simulated statistics are research evidence, not a guarantee of future profitability or prop-firm challenge completion.
