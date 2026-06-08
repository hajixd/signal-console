# Top Strategy PF Split Report

Generated at `2026-06-08T00:09:31Z`.

Scope: materialized catalog strategy folders under `strategy/` that have metadata and `backtest_trades.csv`.
Excluded: `Potential Strategies/` and CSV-only `competition_*` folders without strategy metadata.

Split logic: true pre/post values come from metadata when `selectedTraining*` metrics exist; otherwise the report uses a chronological proxy split of the available trade log: first 70% vs last 30%.

| # | Strategy | Asset | Phase | PF | Trades | Total R | ML | Model | Pre PF | Pre N | Post PF | Post N | Overfit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | competition_usd_jpy_us_first30_last30_reversal_signalweekdayside_direction_opposite_entryminute_930_ex_40e6d9ae | usd_jpy | competition_session_edge | 4.282 | 74 | 19.41 | yes | ML scorer | 1.043 | 48 | 4.103 | 74 | Medium |
| 2 | competition_micro_bitcoin_futures_daily_tsmom_next_overnight_signalweekdayside_direction_contrarian_en_6003fc2d | micro_bitcoin_futures | competition_session_edge | 3.719 | 104 | 199.58 | yes | ML scorer | 1.018 | 20 | 3.719 | 104 | Medium |
| 3 | competition_japanese_yen_futures_us_first30_last30_reversal_signalweekdayside_direction_opposite_entry_11a69e11 | japanese_yen_futures | competition_session_edge | 3.626 | 74 | 18.45 | yes | ML scorer | 1.192 | 207 | 4.350 | 75 | Low |
| 4 | competition_eur_jpy_us_first30_last30_momentum_signalweekdayside_direction_same_entryminute_930_exitba_0a4a3f58 | eur_jpy | competition_session_edge | 3.576 | 65 | 13.76 | yes | ML scorer | 1.058 | 23 | 3.561 | 64 | Medium |
| 5 | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | aud_usd | competition_session_edge | 3.501 | 41 | 9.75 | yes | ML scorer | 1.369 | 22 | 3.647 | 42 | Medium |
| 6 | competition_eur_gbp_us_first30_midday_reversal_weekday_side_3_short_true_rr_5_a5fd6477 | eur_gbp | competition_session_edge | 3.351 | 24 | 9.60 | yes | ML scorer | 0.222 | 11 | 3.351 | 24 | High |
| 7 | competition_usd_jpy_daily_tsmom_next_overnight_weekday_side_2_short_true_rr_3_40484fa0 | usd_jpy | competition_session_edge | 3.279 | 65 | 70.40 | yes | ML scorer | 0.704 | 47 | 3.793 | 82 | Medium |
| 8 | competition_dow_jones_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entrymin_c2a8817b | dow_jones_futures | competition_session_edge | 3.261 | 90 | 66.73 | yes | ML scorer | 0.984 | 193 | 3.261 | 90 | Low |
| 9 | competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_1_long_xasset_rr_4_373963bd | dow_jones_futures | competition_session_edge | 3.261 | 90 | 66.73 | yes | ML scorer | 0.984 | 193 | 3.261 | 90 | Low |
| 10 | competition_copper_futures_london_first30_last30_reversal_month_1_xasset_rr_5_d91f5efb | copper_futures | competition_session_edge | 3.201 | 77 | 19.33 | yes | ML scorer | 0.887 | 152 | 3.201 | 77 | Low |
| 11 | competition_usd_cad_us_first30_last30_momentum_signalmonth_month_3_true_rr_5_08845764 | usd_cad | competition_session_edge | 3.166 | 47 | 16.91 | yes | ML scorer | 1.795 | 13 | 3.093 | 48 | High |
| 12 | competition_dow_jones_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_3d9679eb | dow_jones_futures | competition_session_edge | 3.147 | 61 | 35.92 | yes | ML scorer | 0.879 | 149 | 3.147 | 61 | Low |
| 13 | competition_japanese_yen_futures_london_first30_ny_open_reversal_month_9_6d9e482f | japanese_yen_futures | competition_session_edge | 3.076 | 31 | 31.63 | yes | ML scorer | 1.313 | 85 | 3.076 | 31 | Medium |
| 14 | competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_6a54acc6 | silver_futures | competition_session_edge | 2.989 | 58 | 11.51 | yes | ML scorer | 1.026 | 164 | 2.989 | 58 | Low |
| 15 | competition_silver_futures_daily_tsmom_next_overnight_weekday_side_4_long_xasset_rr_5_e11e58c1 | silver_futures | competition_session_edge | 2.947 | 129 | 45.91 | yes | ML scorer | 1.633 | 276 | 2.947 | 129 | Low |
| 16 | competition_gold_futures_us_first30_last30_reversal_signalmonth_month_10_xasset_rr_5_5519d329 | gold_futures | competition_session_edge | 2.924 | 50 | 9.44 | yes | ML scorer | 0.979 | 131 | 2.924 | 50 | Low |
| 17 | competition_british_pound_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_5f0cb0e3 | british_pound_futures | competition_session_edge | 2.753 | 57 | 11.73 | yes | ML scorer | 1.052 | 151 | 2.753 | 57 | Low |
| 18 | competition_new_zealand_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entry_ce284576 | new_zealand_dollar_futures | competition_session_edge | 2.693 | 48 | 9.09 | yes | ML scorer | 1.575 | 26 | 3.450 | 48 | Medium |
| 19 | competition_us_treasury_5y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_2d6cdfee | us_treasury_5y_note_futures | competition_session_edge | 2.674 | 91 | 57.10 | yes | ML scorer | 1.231 | 47 | 2.674 | 91 | Medium |
| 20 | competition_copper_futures_us_first30_last30_reversal_weekday_side_0_long_xasset_rr_5_412871d7 | copper_futures | competition_session_edge | 2.564 | 65 | 7.19 | yes | ML scorer | 0.972 | 163 | 2.564 | 65 | Low |
| 21 | competition_us_treasury_2y_note_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_ex_d2289e05 | us_treasury_2y_note_futures | competition_session_edge | 2.554 | 62 | 39.72 | yes | ML scorer | 0.825 | 35 | 2.554 | 62 | Medium |
| 22 | competition_usd_cad_us_first30_midday_reversal_month_12_true_rr_5_f342f952 | usd_cad | competition_session_edge | 2.521 | 41 | 20.17 | yes | ML scorer | 2.772 | 11 | 2.521 | 41 | High |
| 23 | competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_a9d7edf6 | silver_futures | competition_session_edge | 2.515 | 63 | 10.77 | yes | ML scorer | 1.000 | 186 | 2.515 | 63 | Low |
| 24 | competition_euro_futures_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitmin_0b54da46 | euro_futures | competition_session_edge | 2.425 | 62 | 81.60 | yes | ML scorer | 1.410 | 191 | 2.425 | 62 | Low |
| 25 | competition_australian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_4fbf7cea | australian_dollar_futures | competition_session_edge | 2.401 | 95 | 59.10 | yes | ML scorer | 0.613 | 288 | 2.348 | 96 | Low |
| 26 | competition_canadian_dollar_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_384613a9 | canadian_dollar_futures | competition_session_edge | 2.359 | 46 | 12.56 | yes | ML scorer | 0.885 | 75 | 2.359 | 46 | Medium |
| 27 | competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_4_short_72a8080e | us_treasury_30y_bond_futures | competition_session_edge | 2.345 | 90 | 46.63 | yes | ML scorer | 1.187 | 304 | 2.345 | 90 | Low |
| 28 | competition_canadian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_b5089070 | canadian_dollar_futures | competition_session_edge | 2.332 | 98 | 72.22 | yes | ML scorer | 1.149 | 298 | 2.332 | 98 | Low |
| 29 | competition_new_zealand_dollar_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_bd3c3876 | new_zealand_dollar_futures | competition_session_edge | 2.288 | 98 | 51.57 | yes | ML scorer | 1.157 | 44 | 2.116 | 99 | Medium |
| 30 | competition_us_treasury_10y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_105476cf | us_treasury_10y_note_futures | competition_session_edge | 2.270 | 90 | 44.53 | yes | ML scorer | 1.169 | 310 | 2.270 | 90 | Low |
| 31 | competition_eur_jpy_daily_tsmom_next_overnight_weekday_side_2_short_true_rr_5_cae527f4 | eur_jpy | competition_session_edge | 2.236 | 101 | 85.57 | yes | ML scorer | 0.666 | 51 | 2.285 | 98 | Low |
| 32 | competition_gbp_usd_london_first30_last30_reversal_month_12_true_rr_5_f1420549 | gbp_usd | competition_session_edge | 2.215 | 27 | 6.43 | yes | ML scorer | 0.979 | 20 | 2.215 | 27 | High |
| 33 | competition_us_treasury_2y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_027092c6 | us_treasury_2y_note_futures | competition_session_edge | 2.214 | 90 | 48.52 | yes | ML scorer | 0.402 | 45 | 2.727 | 90 | Medium |
| 34 | competition_usd_jpy_asia_range_london_breakout_signalweekdayside_breakendminute_360_breakstartminute_1_83470b07 | usd_jpy | competition_session_edge | 2.188 | 87 | 20.16 | yes | ML scorer | 1.902 | 40 | 2.188 | 87 | Medium |
| 35 | nasdaq_100_futures_round_hundred_rejection_15m | nasdaq_100_futures | round_number_rejection | 2.017 | 53 | 28.73 | yes | Decision stump | 0.713 | 152 | 2.017 | 53 | Low |
| 36 | competition_gbp_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_9b2547fb | gbp_usd | competition_session_edge | 1.957 | 57 | 7.35 | yes | ML scorer | 1.166 | 27 | 2.515 | 57 | Medium |
| 37 | competition_usd_cad_us_first30_last30_momentum_signalmonth_direction_same_entryminute_930_exitbarminut_c1317995 | usd_cad | competition_session_edge | 1.800 | 101 | 16.73 | yes | ML scorer | 1.021 | 43 | 2.637 | 108 | Medium |
| 38 | competition_us_treasury_5y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_1942c62b | us_treasury_5y_note_futures | competition_session_edge | 1.760 | 76 | 13.06 | yes | ML scorer | 2.561 | 38 | 2.884 | 74 | Medium |
| 39 | competition_australian_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entrym_77aa2b55 | australian_dollar_futures | competition_session_edge | 1.732 | 61 | 6.86 | yes | ML scorer | 1.372 | 165 | 2.361 | 61 | Low |
| 40 | competition_eur_jpy_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_563aa3f1 | eur_jpy | competition_session_edge | 1.723 | 68 | 18.08 | yes | ML scorer | 1.708 | 44 | 2.667 | 68 | Medium |
| 41 | competition_us_treasury_5y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_62e3b6d2 | us_treasury_5y_note_futures | competition_session_edge | 1.552 | 99 | 10.00 | yes | ML scorer | 1.383 | 55 | 2.215 | 99 | Low |
| 42 | competition_usd_cad_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminute_945_exitminu_dca02dc1 | usd_cad | competition_session_edge | 1.548 | 74 | 15.19 | yes | ML scorer | 1.377 | 44 | 3.022 | 74 | Medium |
| 43 | competition_aud_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_c8c5223e | aud_usd | competition_session_edge | 1.416 | 60 | 4.68 | yes | ML scorer | 1.556 | 34 | 2.357 | 60 | Medium |
| 44 | competition_new_zealand_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exi_7ad85d81 | new_zealand_dollar_futures | competition_session_edge | 1.331 | 79 | 11.07 | yes | ML scorer | 1.093 | 28 | 2.070 | 79 | Medium |
| 45 | competition_crude_oil_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exit_ny_o_315d7644 | crude_oil_futures | competition_session_edge | 1.309 | 102 | 13.62 | yes | ML scorer | 1.312 | 176 | 3.232 | 102 | Low |
| 46 | competition_nzd_usd_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitminute_9_183b1d88 | nzd_usd | competition_session_edge | 1.285 | 80 | 9.89 | yes | ML scorer | 1.165 | 33 | 2.382 | 100 | Medium |
| 47 | competition_us_treasury_2y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_339e7451 | us_treasury_2y_note_futures | competition_session_edge | 1.271 | 66 | 3.98 | yes | ML scorer | 1.282 | 42 | 2.520 | 66 | Medium |
| 48 | competition_gbp_jpy_daily_tsmom_next_overnight_signalmonth_direction_contrarian_entryminute_945_exitmi_ab520ea7 | gbp_jpy | competition_session_edge | 1.257 | 86 | 9.81 | yes | ML scorer | 3.219 | 39 | 2.016 | 86 | Medium |
| 49 | competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_1aa4fa28 | australian_dollar_futures | competition_session_edge | 1.238 | 65 | 6.88 | yes | ML scorer | 1.514 | 204 | 2.236 | 65 | Low |
| 50 | competition_eur_chf_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_391afa4a | eur_chf | competition_session_edge | 1.221 | 80 | 8.10 | yes | ML scorer | 2.124 | 37 | 3.221 | 94 | Medium |
| 51 | competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_dcd12f25 | australian_dollar_futures | competition_session_edge | 1.191 | 74 | 6.38 | yes | ML scorer | 1.396 | 154 | 2.596 | 75 | Low |
| 52 | competition_russell_2000_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarmi_801e97d2 | russell_2000_futures | competition_session_edge | 1.181 | 59 | 4.77 | yes | ML scorer | 1.281 | 49 | 2.853 | 59 | Medium |
| 53 | competition_canadian_dollar_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exi_31e5e01a | canadian_dollar_futures | competition_session_edge | 1.080 | 89 | 3.31 | yes | ML scorer | 1.296 | 212 | 2.850 | 89 | Low |
| 54 | competition_silver_futures_london_first30_ny_open_momentum_signalweekdayside_direction_same_entryminut_5ce60b39 | silver_futures | competition_session_edge | 0.974 | 79 | -1.05 | yes | ML scorer | 1.368 | 215 | 2.202 | 80 | Low |
| 55 | competition_gbp_jpy_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_945_ming_297a7a1d | gbp_jpy | competition_session_edge | 0.961 | 86 | -1.70 | yes | ML scorer | 1.287 | 23 | 2.075 | 100 | Medium |
| 56 | competition_gbp_jpy_london_first30_ny_open_reversal_signalmonth_direction_opposite_entryminute_480_exi_d549e3a7 | gbp_jpy | competition_session_edge | 0.901 | 59 | -3.05 | yes | ML scorer | 1.503 | 31 | 2.599 | 59 | Medium |
| 57 | competition_canadian_dollar_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entrymin_eee85315 | canadian_dollar_futures | competition_session_edge | 0.851 | 82 | -6.31 | yes | ML scorer | 1.461 | 243 | 2.327 | 82 | Low |
| 58 | competition_gold_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entryminute_9_c8e1caae | gold_futures | competition_session_edge | 0.717 | 115 | -18.96 | yes | ML scorer | 1.392 | 311 | 2.144 | 116 | Low |

## Overfit Notes

- **#1 competition_usd_jpy_us_first30_last30_reversal_signalweekdayside_direction_opposite_entryminute_930_ex_40e6d9ae**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#2 competition_micro_bitcoin_futures_daily_tsmom_next_overnight_signalweekdayside_direction_contrarian_en_6003fc2d**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#3 competition_japanese_yen_futures_us_first30_last30_reversal_signalweekdayside_direction_opposite_entry_11a69e11**: Low - forward stronger than fit sample
- **#4 competition_eur_jpy_us_first30_last30_momentum_signalweekdayside_direction_same_entryminute_930_exitba_0a4a3f58**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#5 competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e**: Medium - small total sample; forward stronger than fit sample
- **#6 competition_eur_gbp_us_first30_midday_reversal_weekday_side_3_short_true_rr_5_a5fd6477**: High - very small total sample; thin pre-split sample; thin post-split sample; forward stronger than fit sample
- **#7 competition_usd_jpy_daily_tsmom_next_overnight_weekday_side_2_short_true_rr_3_40484fa0**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#8 competition_dow_jones_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entrymin_c2a8817b**: Low - forward stronger than fit sample
- **#9 competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_1_long_xasset_rr_4_373963bd**: Low - forward stronger than fit sample
- **#10 competition_copper_futures_london_first30_last30_reversal_month_1_xasset_rr_5_d91f5efb**: Low - forward stronger than fit sample
- **#11 competition_usd_cad_us_first30_last30_momentum_signalmonth_month_3_true_rr_5_08845764**: High - small total sample; thin pre-split sample; forward stronger than fit sample
- **#12 competition_dow_jones_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_3d9679eb**: Low - forward stronger than fit sample
- **#13 competition_japanese_yen_futures_london_first30_ny_open_reversal_month_9_6d9e482f**: Medium - small total sample; forward stronger than fit sample
- **#14 competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_6a54acc6**: Low - forward stronger than fit sample
- **#15 competition_silver_futures_daily_tsmom_next_overnight_weekday_side_4_long_xasset_rr_5_e11e58c1**: Low - forward stronger than fit sample
- **#16 competition_gold_futures_us_first30_last30_reversal_signalmonth_month_10_xasset_rr_5_5519d329**: Low - forward stronger than fit sample
- **#17 competition_british_pound_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_5f0cb0e3**: Low - forward stronger than fit sample
- **#18 competition_new_zealand_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entry_ce284576**: Medium - small total sample; forward stronger than fit sample
- **#19 competition_us_treasury_5y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_2d6cdfee**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#20 competition_copper_futures_us_first30_last30_reversal_weekday_side_0_long_xasset_rr_5_412871d7**: Low - forward stronger than fit sample
- **#21 competition_us_treasury_2y_note_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_ex_d2289e05**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#22 competition_usd_cad_us_first30_midday_reversal_month_12_true_rr_5_f342f952**: High - small total sample; thin pre-split sample
- **#23 competition_silver_futures_us_first30_last30_reversal_signalmonth_xasset_rr_5_a9d7edf6**: Low - forward stronger than fit sample
- **#24 competition_euro_futures_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitmin_0b54da46**: Low - forward stronger than fit sample
- **#25 competition_australian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_4fbf7cea**: Low - forward stronger than fit sample
- **#26 competition_canadian_dollar_futures_us_first30_last30_momentum_signalmonth_month_3_xasset_rr_5_384613a9**: Medium - small total sample; forward stronger than fit sample
- **#27 competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_4_short_72a8080e**: Low - forward stronger than fit sample
- **#28 competition_canadian_dollar_futures_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_b5089070**: Low - forward stronger than fit sample
- **#29 competition_new_zealand_dollar_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_bd3c3876**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#30 competition_us_treasury_10y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_105476cf**: Low - forward stronger than fit sample
- **#31 competition_eur_jpy_daily_tsmom_next_overnight_weekday_side_2_short_true_rr_5_cae527f4**: Low - forward stronger than fit sample
- **#32 competition_gbp_usd_london_first30_last30_reversal_month_12_true_rr_5_f1420549**: High - very small total sample; thin post-split sample; forward stronger than fit sample
- **#33 competition_us_treasury_2y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_xasset_rr_5_027092c6**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#34 competition_usd_jpy_asia_range_london_breakout_signalweekdayside_breakendminute_360_breakstartminute_1_83470b07**: Medium - ML fit sample under 50 trades
- **#35 nasdaq_100_futures_round_hundred_rejection_15m**: Low - forward stronger than fit sample
- **#36 competition_gbp_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_9b2547fb**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#37 competition_usd_cad_us_first30_last30_momentum_signalmonth_direction_same_entryminute_930_exitbarminut_c1317995**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#38 competition_us_treasury_5y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_1942c62b**: Medium - ML fit sample under 50 trades
- **#39 competition_australian_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entrym_77aa2b55**: Low - forward stronger than fit sample
- **#40 competition_eur_jpy_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_563aa3f1**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#41 competition_us_treasury_5y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_62e3b6d2**: Low - forward stronger than fit sample
- **#42 competition_usd_cad_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminute_945_exitminu_dca02dc1**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#43 competition_aud_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_c8c5223e**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#44 competition_new_zealand_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exi_7ad85d81**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#45 competition_crude_oil_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exit_ny_o_315d7644**: Low - forward stronger than fit sample
- **#46 competition_nzd_usd_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitminute_9_183b1d88**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#47 competition_us_treasury_2y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_339e7451**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#48 competition_gbp_jpy_daily_tsmom_next_overnight_signalmonth_direction_contrarian_entryminute_945_exitmi_ab520ea7**: Medium - moderate PF decay
- **#49 competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_1aa4fa28**: Low - forward stronger than fit sample
- **#50 competition_eur_chf_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_391afa4a**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#51 competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_dcd12f25**: Low - forward stronger than fit sample
- **#52 competition_russell_2000_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarmi_801e97d2**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#53 competition_canadian_dollar_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exi_31e5e01a**: Low - forward stronger than fit sample
- **#54 competition_silver_futures_london_first30_ny_open_momentum_signalweekdayside_direction_same_entryminut_5ce60b39**: Low - forward stronger than fit sample
- **#55 competition_gbp_jpy_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_945_ming_297a7a1d**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#56 competition_gbp_jpy_london_first30_ny_open_reversal_signalmonth_direction_opposite_entryminute_480_exi_d549e3a7**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#57 competition_canadian_dollar_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entrymin_eee85315**: Low - forward stronger than fit sample
- **#58 competition_gold_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entryminute_9_c8e1caae**: Low - forward stronger than fit sample
