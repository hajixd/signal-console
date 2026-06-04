# Futures PF>2 / RR>=2 Deep Validation

Generated: 2026-06-04T09:26:18.851491+00:00

## Research Basis

- Time-series momentum: Moskowitz, Ooi, and Pedersen document futures momentum across equity index, currency, commodity, and bond futures.
- Intraday momentum: Baltussen, Da, Lammers, and Martens document broad futures last-30-minute predictability from prior intraday returns across major asset classes.
- Opening range breakout: the ORB literature supports the contraction/expansion idea but warns that apparent crude-oil ORB profitability can fail sub-period robustness.
- CME time-series momentum methodology notes emphasize continuous futures construction, rollover handling, volatility estimation, and turnover/cost sensitivity.

## Fresh Raw Search Pass

- Built/tested 3,141 futures-only raw research specs across 23 futures assets.
- Gate: PF > 2, trades > 21, total R > 0.
- Qualified: 0.
- Malformed generated specs safely rejected: 23.
- Best raw specs were around PF 1.34, so I do not recommend promoting any fresh simple-engine seed result.

Top raw-spec misses:

| Strategy | Asset | Engine | PF | Trades | Total R |
| --- | --- | --- | ---: | ---: | ---: |
| `rs_gao_intraday_momentum_last30_us_treasury_5y_note_futures_intraday_momentum_7923f428` | us_treasury_5y_note_futures | intraday_momentum | 1.378 | 754 | 62.23 |
| `rs_night_day_overnight_bias_gold_futures_overnight_bias_c21e58d2` | gold_futures | overnight_bias | 1.343 | 855 | 521.46 |
| `rs_ny_opening_range_break_micro_bitcoin_futures_range_break_280e2402` | micro_bitcoin_futures | range_break | 1.343 | 1042 | 166.96 |
| `rs_fx_london_open_momentum_micro_ether_futures_intraday_momentum_e8c4af08` | micro_ether_futures | intraday_momentum | 1.330 | 351 | 100.00 |
| `rs_gao_intraday_momentum_last30_us_treasury_5y_note_futures_intraday_momentum_c58877c4` | us_treasury_5y_note_futures | intraday_momentum | 1.325 | 860 | 62.89 |
| `rs_ny_opening_range_break_micro_bitcoin_futures_range_break_536247ea` | micro_bitcoin_futures | range_break | 1.320 | 1042 | 150.60 |
| `rs_gao_intraday_momentum_last30_us_treasury_2y_note_futures_intraday_momentum_b972837c` | us_treasury_2y_note_futures | intraday_momentum | 1.314 | 727 | 53.80 |
| `rs_crude_inventory_session_crude_oil_futures_intraday_momentum_25390efd` | crude_oil_futures | intraday_momentum | 1.307 | 221 | 65.37 |

## Strong True-RR Futures Candidates

Tier A requires PF>=2, RR>=2, trades>=50, min quarter PF>=1.2, bootstrap p05>=1.2, block-bootstrap p05>=1.2, and annual pass rate>=0.8.
Tier B relaxes sample/stability slightly and should stay watchlist until manually inspected.

- True-RR futures candidates passing the published anti-overfit screen: 16
- Tier counts: {'A': 10, 'B': 5, 'watch': 1}

| Tier | Strategy | Asset | PF | Trades | RR | Min Q PF | Boot p05 | Block p05 | Annual |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | `competition_gold_futures_us_first30_last30_reversal_signalmonth_month_10_xasset_rr_5_5519d329` | gold_futures | 2.924 | 50 | 4.91 | 2.023 | 1.610 | 1.804 | 1.00 |
| A | `competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_6a54acc6` | silver_futures | 2.833 | 58 | 4.83 | 1.304 | 1.507 | 2.193 | 1.00 |
| A | `competition_us_treasury_2y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_027092c6` | us_treasury_2y_note_futures | 2.727 | 90 | 4.01 | 1.706 | 1.581 | 1.534 | 1.00 |
| A | `competition_british_pound_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_5f0cb0e3` | british_pound_futures | 2.451 | 57 | 4.62 | 1.515 | 1.323 | 1.321 | 1.00 |
| A | `competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_a9d7edf6` | silver_futures | 2.410 | 63 | 4.83 | 1.518 | 1.399 | 1.669 | 1.00 |
| A | `competition_us_treasury_5y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_2d6cdfee` | us_treasury_5y_note_futures | 2.405 | 91 | 4.34 | 1.901 | 1.582 | 1.682 | 1.00 |
| A | `competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_1_long_xasset_rr_4_373963bd` | dow_jones_futures | 2.356 | 90 | 3.96 | 1.477 | 1.547 | 1.571 | 1.00 |
| A | `competition_australian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_4fbf7cea` | australian_dollar_futures | 2.348 | 96 | 4.69 | 1.471 | 1.571 | 1.630 | 0.80 |
| A | `competition_canadian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_b5089070` | canadian_dollar_futures | 2.332 | 98 | 4.30 | 1.360 | 1.608 | 1.807 | 0.80 |
| A | `competition_us_treasury_10y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_105476cf` | us_treasury_10y_note_futures | 2.162 | 90 | 4.02 | 1.347 | 1.439 | 1.364 | 1.00 |
| B | `competition_dow_jones_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_3d9679eb` | dow_jones_futures | 3.147 | 61 | 4.93 | 1.065 | 1.925 | 1.554 | 1.00 |
| B | `competition_copper_futures_london_first30_last30_reversal_month_1_xasset_rr_5_d91f5efb` | copper_futures | 2.881 | 77 | 4.77 | 1.180 | 1.712 | 1.747 | 1.00 |
| B | `competition_copper_futures_us_first30_last30_reversal_weekday_side_0_long_xasset_rr_5_412871d7` | copper_futures | 2.564 | 65 | 4.84 | 1.435 | 1.518 | 1.185 | 0.75 |
| B | `competition_canadian_dollar_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_384613a9` | canadian_dollar_futures | 2.359 | 46 | 4.62 | 1.247 | 1.257 | 1.545 | 1.00 |
| B | `competition_silver_futures_daily_tsmom_next_overnight_weekday_side_4_long_xasset_rr_5_e11e58c1` | silver_futures | 2.288 | 131 | 4.79 | 1.096 | 1.536 | 1.489 | 1.00 |
| watch | `competition_new_zealand_dollar_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_bd3c3876` | new_zealand_dollar_futures | 2.116 | 99 | 4.66 | 1.177 | 1.340 | 1.266 | 0.60 |

## Additional Broader-Catalog Futures Passes

These pass the broader stress catalog with RR>=2 but are not in the xasset strong-anti-overfit CSV. Treat as secondary candidates.

| Strategy | Asset | PF | Trades | RR | Min Q PF | Boot p05 | Block p05 | Annual |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `competition_japanese_yen_futures_london_first30_ny_open_reversal_month_9_6d9e482f` | japanese_yen_futures | 3.076 | 31 | 4.63 | 1.868 | 1.524 | 2.304 | 1.00 |
| `competition_dow_jones_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entrymin_c2a8817b` | dow_jones_futures | 2.356 | 90 | 3.96 | 1.477 | 1.463 | 1.552 | 1.00 |
| `competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_4_short_72a8080e` | us_treasury_30y_bond_futures | 2.245 | 90 | 4.01 | 1.617 | 1.493 | 1.526 | 1.00 |
| `nasdaq_100_futures_round_hundred_rejection_15m` | nasdaq_100_futures | 2.123 | 54 | 3.00 | 1.333 | 1.284 | 1.253 | 0.75 |

## Verdict

- No fresh raw research-engine futures strategy cleared PF>2 today.
- The best immediate candidates are the Tier A true-RR futures strategies above; they already have RR around 4-5, PF above 2, and multiple anti-overfit checks above threshold.
- I would inspect charts/trade distributions on Tier A before enabling live, especially repeated family/asset variants.

