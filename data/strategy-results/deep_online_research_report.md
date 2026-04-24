# Deep Online Strategy Expansion Report

Run date: 2026-04-22

## Research Inputs

- Kaggle-style ML idea: OHLCV + indicators + sentiment/labels are commonly packaged for predictive trading experiments; we mirrored the usable part locally with OHLC-derived indicators and walk-forward labels.
- Reddit / AI trading ideas: common themes were meta-labeling, XGBoost/Random Forest/linear ensembles, ORB + VWAP/EMA filters, liquidity sweep + BOS/FVG, and skepticism toward naive ORB in isolation.
- ICT / TJR proxy: liquidity sweep, market-structure shift or break of structure, displacement/FVG, then retrace/continuation.
- Tori Trades proxy: 3-touch trendline break using pivots, slope/residual filter, one attempt per line, ATR-bounded risk.

## New Code

- Added source-inspired strategies to `machine_learning/reddit_prop_strategy_sweep.py`:
  - `ict_turtle_soup`
  - `ict_sweep_fvg`
  - `tjr_sweep_retrace`
  - `tori_trendline_break`
- Added simple ML model specs in `machine_learning/common.py`:
  - `sgd_logistic_clf`, `gaussian_nb`, `knn_clf`, `tree_clf`, `gb_clf`, `ada_clf`, `mlp_clf`
- Added `machine_learning/benchmark_simple_ml_universe.py` for leak-aware walk-forward ML filtering across assets.
- Added `machine_learning/build_prop_challenge_balanced_online_plus.py` for the new preset.

## Completed Strategy Sweeps

Artifacts:

- `deep_online_strategy_quick_best_by_asset_strategy.csv`
- `deep_online_strategy_quick_trades.csv`
- `deep_online_strategy_quick_challenge_frontier.csv`
- `deep_online_strategy_quick_addon_eval.csv`

Best standalone source-strategy candidates:

- `CL ict_sweep_fvg`: PF 2.37, WR 50.0%, 14 trades
- `NQ ict_turtle_soup`: PF 2.34, WR 61.5%, 26 trades
- `RTY ict_sweep_fvg`: PF 1.95, WR 57.7%, 26 trades
- `NQ tjr_sweep_retrace`: PF 1.96, WR 61.5%, 13 trades
- `SI tori_trendline_break`: PF 1.60, WR 53.8%, 106 trades

Standalone source strategies did not form a passable prop basket by themselves.

## Completed ML Sweeps

Artifacts:

- `simple_ml_prop_futures_fast_benchmark.csv`
- `simple_ml_prop_futures_heavy_promising_benchmark.csv`

Best ML filters observed:

- `YM mean_reversion sgd_logistic_clf`: test PF 7.08, WR 75.8%, 33 trades
- `YM momentum xgb_clf`: test PF 6.30, WR 73.6%, 121 trades
- `YM mean_reversion extra_clf`: test PF 6.29, WR 73.5%, 102 trades
- `YM momentum hist_clf`: test PF 6.30, WR 73.6%, 87 trades
- `NQ mean_reversion tree_clf`: test PF 3.92, WR 63.4%, 71 trades
- `NQ momentum extra_clf`: test PF 3.89, WR 63.2%, 87 trades
- `HG mean_reversion sgd_logistic_clf`: test PF 3.26, WR 80.3%, 61 trades
- `CL mean_reversion sgd_logistic_clf`: test PF 2.73, WR 77.6%, 85 trades

These are useful as future live/portfolio filters, but they are not direct preset trades yet because the benchmark output is meta-label filtered phase outcomes, not complete bracket/risk trade rows.

## New Preset

Default preset created: `topstep-100k-balanced-online-plus`

It adds only the NQ ICT turtle-soup variant to Balanced Turbo because this was the cleanest add-on that improved pass speed and PF while keeping the basket above 70% win rate.

Results:

- Trades: 1,161
- Win rate: 70.20%
- Profit factor: 1.998
- 7 day pass rate: 8.96%
- 14 day pass rate: 29.17%
- 30 day pass rate: 69.58%
- Eventual pass rate: 83.75%

Previous Balanced Turbo:

- Win rate: 70.40%
- Profit factor: 1.984
- 7 day pass rate: 7.74%
- 14 day pass rate: 25.31%
- 30 day pass rate: 63.39%
- Eventual pass rate: 82.64%
