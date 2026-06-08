# Futures PF>2 / RR>2 Nonduplicate Selection - 2026-06-07

This report filters the loaded strategy catalog to futures strategies only, then requires PF > 2, planned RR > 2, stress-validation pass, at least 40 trades, low split-audit overfit risk, and no same-trade duplicate overlap.

## Summary

- Loaded futures stress rows: 72
- PF/RR/stress candidates before overfit and duplicate rejection: 20
- Selected strict nonduplicates: 13
- Exact/near duplicate rejections: 2
- Watch rejections: 5

## Selected

| Rank | Strategy | Asset | Trades | PF | Min RR | Quarter PF | Bootstrap p05 | Block p05 | Annual pass | First70 PF | Last30 PF |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `competition_copper_futures_london_first30_last30_reversal_month_1_xasset_rr_5_d91f5efb` | copper_futures | 77 | 2.881 | 4.774 | 1.180 | 1.712 | 1.747 | 1.000 | 2.057 | 6.817 |
| 2 | `competition_gold_futures_us_first30_last30_reversal_signalmonth_month_10_xasset_rr_5_5519d329` | gold_futures | 50 | 2.924 | 4.914 | 2.023 | 1.610 | 1.804 | 1.000 | 2.814 | 3.191 |
| 3 | `competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_6a54acc6` | silver_futures | 58 | 2.833 | 4.832 | 1.304 | 1.507 | 2.193 | 1.000 | 2.456 | 4.868 |
| 4 | `competition_dow_jones_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_3d9679eb` | dow_jones_futures | 61 | 3.147 | 4.934 | 1.065 | 1.925 | 1.554 | 1.000 | 3.821 | 1.382 |
| 5 | `competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_1_long_xasset_rr_4_373963bd` | dow_jones_futures | 90 | 2.356 | 3.962 | 1.477 | 1.547 | 1.571 | 1.000 | 2.259 | 7.452 |
| 6 | `competition_silver_futures_daily_tsmom_next_overnight_weekday_side_4_long_xasset_rr_5_e11e58c1` | silver_futures | 131 | 2.288 | 4.793 | 1.096 | 1.536 | 1.489 | 1.000 | 2.983 | 2.882 |
| 7 | `competition_australian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_4fbf7cea` | australian_dollar_futures | 96 | 2.348 | 4.687 | 1.471 | 1.571 | 1.630 | 0.800 | 2.694 | 1.826 |
| 8 | `competition_canadian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_b5089070` | canadian_dollar_futures | 98 | 2.332 | 4.305 | 1.360 | 1.608 | 1.807 | 0.800 | 2.689 | 1.611 |
| 9 | `competition_british_pound_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_5f0cb0e3` | british_pound_futures | 57 | 2.451 | 4.618 | 1.515 | 1.323 | 1.321 | 1.000 | 2.112 | 4.204 |
| 10 | `competition_copper_futures_us_first30_last30_reversal_weekday_side_0_long_xasset_rr_5_412871d7` | copper_futures | 65 | 2.564 | 4.840 | 1.435 | 1.518 | 1.185 | 0.750 | 3.143 | 1.642 |
| 11 | `competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_4_short_72a8080e` | us_treasury_30y_bond_futures | 90 | 2.245 | 4.012 | 1.617 | 1.493 | 1.526 | 1.000 | 2.165 | 2.728 |
| 12 | `competition_us_treasury_10y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_105476cf` | us_treasury_10y_note_futures | 90 | 2.162 | 4.023 | 1.347 | 1.439 | 1.364 | 1.000 | 2.019 | 2.794 |
| 13 | `nasdaq_100_futures_round_hundred_rejection_15m` | nasdaq_100_futures | 54 | 2.123 | 3.000 | 1.333 | 1.284 | 1.253 | 0.750 | 2.299 | 1.500 |

## Duplicate Rejections

| Strategy | Duplicate Of | Exact Containment | Near Containment |
| --- | --- | ---: | ---: |
| `competition_dow_jones_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entrymin_c2a8817b` | `competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_1_long_xasset_rr_4_373963bd` | 1.000 | 1.000 |
| `competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_a9d7edf6` | `competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_6a54acc6` | 1.000 | 1.000 |

## Watch Rejections

| Strategy | Asset | Reason | Trades | PF | Min RR | Overfit Risk |
| --- | --- | --- | ---: | ---: | ---: | --- |
| `competition_japanese_yen_futures_london_first30_ny_open_reversal_month_9_6d9e482f` | japanese_yen_futures | trades_lt_40,overfit_risk_not_low | 31 | 3.076 | 4.633 | Medium |
| `competition_us_treasury_2y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_027092c6` | us_treasury_2y_note_futures | overfit_risk_not_low | 90 | 2.727 | 4.011 | Medium |
| `competition_us_treasury_5y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_2d6cdfee` | us_treasury_5y_note_futures | overfit_risk_not_low | 91 | 2.405 | 4.336 | Medium |
| `competition_new_zealand_dollar_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_bd3c3876` | new_zealand_dollar_futures | overfit_risk_not_low | 99 | 2.116 | 4.658 | Medium |
| `competition_canadian_dollar_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_384613a9` | canadian_dollar_futures | overfit_risk_not_low | 46 | 2.359 | 4.622 | Medium |

## Tests Used

- Chronological half-split PF > 1.
- Chronological quarter-split PF > 1.
- Rolling 20-trade PF lower quartile > 1.
- Ordinary bootstrap PF p05 > 1.
- Five-trade block bootstrap PF p05 > 0.9.
- Calendar-year walk-forward pass rate >= 60%.
- Split-audit overfit risk must be Low.
- Same-trade duplicate containment must stay below 80%; near duplicate window is 15 minutes.
