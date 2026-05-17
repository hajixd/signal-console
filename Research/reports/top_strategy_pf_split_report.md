# Top Strategy PF Split Report

Generated at `2026-05-17T21:15:17Z`.

Scope: materialized catalog strategy folders under `strategy/` that have metadata and `backtest_trades.csv`.
Excluded: `Potential Strategies/` and CSV-only `competition_*` folders without strategy metadata.

Split logic: true pre/post values come from metadata when `selectedTraining*` metrics exist; otherwise the report uses a chronological proxy split of the available trade log: first 70% vs last 30%.

| # | Strategy | Asset | Phase | PF | Trades | Total R | ML | Model | Pre PF | Pre N | Post PF | Post N | Overfit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | competition_japanese_yen_futures_us_first30_last30_reversal_signalweekdayside_direction_opposite_entry_11a69e11 | japanese_yen_futures | competition_session_edge | 4.350 | 75 | 20.98 | yes | ML scorer | 1.192 | 207 | 4.350 | 75 | Low |
| 2 | competition_usd_jpy_us_first30_last30_reversal_signalweekdayside_direction_opposite_entryminute_930_ex_40e6d9ae | usd_jpy | competition_session_edge | 3.984 | 74 | 17.15 | yes | ML scorer | 1.043 | 48 | 3.984 | 74 | Medium |
| 3 | competition_micro_ether_futures_daily_tsmom_next_overnight_weekday_side_1_long_dc4c34f3 | micro_ether_futures | competition_session_edge | 3.950 | 105 | 253.93 | yes | ML scorer | 0.000 | 3 | 3.950 | 105 | High |
| 4 | competition_micro_ether_futures_london_first30_ny_open_momentum_weekday_side_3_short_e779cb85 | micro_ether_futures | competition_session_edge | 3.567 | 53 | 69.58 | yes | ML scorer | 999.000 | 2 | 3.567 | 53 | High |
| 5 | competition_micro_bitcoin_futures_daily_tsmom_next_overnight_signalweekdayside_direction_contrarian_en_6003fc2d | micro_bitcoin_futures | competition_session_edge | 3.553 | 104 | 218.77 | yes | ML scorer | 2.095 | 20 | 3.553 | 104 | Medium |
| 6 | competition_new_zealand_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entry_ce284576 | new_zealand_dollar_futures | competition_session_edge | 3.450 | 48 | 11.29 | yes | ML scorer | 1.575 | 26 | 3.450 | 48 | Medium |
| 7 | competition_eur_jpy_us_first30_last30_momentum_signalweekdayside_direction_same_entryminute_930_exitba_0a4a3f58 | eur_jpy | competition_session_edge | 3.430 | 64 | 13.81 | yes | ML scorer | 1.058 | 23 | 3.430 | 64 | Medium |
| 8 | competition_crude_oil_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exit_ny_o_315d7644 | crude_oil_futures | competition_session_edge | 3.232 | 102 | 161.74 | yes | ML scorer | 1.312 | 176 | 3.232 | 102 | Low |
| 9 | competition_eur_chf_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_391afa4a | eur_chf | competition_session_edge | 3.221 | 94 | 162.70 | yes | ML scorer | 2.124 | 37 | 3.221 | 94 | Medium |
| 10 | competition_corn_futures_us_first30_midday_momentum_weekday_side_3_long_cbe1149a | corn_futures | competition_session_edge | 3.220 | 81 | 62.72 | yes | ML scorer | 0.804 | 41 | 3.220 | 81 | Medium |
| 11 | competition_usd_chf_daily_tsmom_next_overnight_month_12_4f2024c0 | usd_chf | competition_session_edge | 3.111 | 75 | 118.66 | yes | ML scorer | 1.389 | 50 | 3.111 | 75 | Low |
| 12 | competition_natural_gas_futures_us_first30_last30_momentum_month_9_c678e3c1 | natural_gas_futures | competition_session_edge | 3.105 | 56 | 8.61 | yes | ML scorer | 0.874 | 161 | 3.105 | 56 | Low |
| 13 | competition_us_treasury_2y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_e133c7a3 | us_treasury_2y_note_futures | competition_session_edge | 3.076 | 96 | 86.96 | yes | ML scorer | 0.641 | 46 | 3.076 | 96 | Medium |
| 14 | competition_micro_ether_futures_london_first30_ny_open_reversal_weekday_side_0_long_d64af48a | micro_ether_futures | competition_session_edge | 3.059 | 44 | 41.16 | yes | ML scorer | 0.000 | 0 | 3.059 | 44 | High |
| 15 | competition_usd_cad_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminute_945_exitminu_dca02dc1 | usd_cad | competition_session_edge | 3.022 | 74 | 129.25 | yes | ML scorer | 1.377 | 44 | 3.022 | 74 | Medium |
| 16 | competition_us_treasury_5y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_6dc543f7 | us_treasury_5y_note_futures | competition_session_edge | 2.986 | 95 | 75.75 | yes | ML scorer | 1.221 | 42 | 2.986 | 95 | Medium |
| 17 | competition_copper_futures_us_first30_last30_reversal_weekday_side_0_long_04d98061 | copper_futures | competition_session_edge | 2.926 | 75 | 9.79 | yes | ML scorer | 1.240 | 188 | 2.926 | 75 | Low |
| 18 | competition_gbp_jpy_daily_tsmom_next_rth_month_6_4be2e72e | gbp_jpy | competition_session_edge | 2.911 | 68 | 107.23 | yes | ML scorer | 0.571 | 44 | 2.911 | 68 | Medium |
| 19 | competition_us_treasury_5y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_1942c62b | us_treasury_5y_note_futures | competition_session_edge | 2.884 | 74 | 22.74 | yes | ML scorer | 2.561 | 38 | 2.884 | 74 | Medium |
| 20 | competition_japanese_yen_futures_overnight_close_to_open_bias_short_month_10_6bc43a25 | japanese_yen_futures | competition_session_edge | 2.869 | 89 | 196.50 | yes | ML scorer | 1.140 | 265 | 2.869 | 89 | Low |
| 21 | competition_russell_2000_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarmi_801e97d2 | russell_2000_futures | competition_session_edge | 2.853 | 59 | 49.07 | yes | ML scorer | 1.281 | 49 | 2.853 | 59 | Medium |
| 22 | competition_canadian_dollar_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exi_31e5e01a | canadian_dollar_futures | competition_session_edge | 2.850 | 89 | 110.00 | yes | ML scorer | 1.296 | 212 | 2.850 | 89 | Low |
| 23 | competition_gbp_jpy_london_first30_last30_momentum_weekday_side_4_long_6a554e5f | gbp_jpy | competition_session_edge | 2.801 | 81 | 19.08 | yes | ML scorer | 1.410 | 36 | 2.801 | 81 | Medium |
| 24 | competition_gold_futures_us_first30_last30_reversal_weekday_side_0_long_c0163084 | gold_futures | competition_session_edge | 2.785 | 71 | 11.01 | yes | ML scorer | 0.794 | 189 | 2.785 | 71 | Low |
| 25 | competition_usd_cad_london_first30_ny_open_momentum_month_12_f0df56f8 | usd_cad | competition_session_edge | 2.776 | 79 | 134.75 | yes | ML scorer | 0.986 | 43 | 2.776 | 79 | Medium |
| 26 | competition_eur_cad_us_first30_midday_momentum_month_10_8e114485 | eur_cad | competition_session_edge | 2.775 | 63 | 28.54 | yes | ML scorer | 0.655 | 23 | 2.775 | 63 | Medium |
| 27 | gbp_usd_ny_sweep_bayes | gbp_usd | ny_sweep_playbook | 2.750 | 38 | 28.00 | yes | Bayes scorer | 2.500 | 27 | 3.500 | 11 | Medium |
| 28 | competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f | aud_nzd | competition_session_edge | 2.747 | 87 | 73.26 | yes | ML scorer | 0.910 | 38 | 2.747 | 87 | Medium |
| 29 | competition_gbp_jpy_london_first30_last30_reversal_weekday_side_4_long_ef0c2df3 | gbp_jpy | competition_session_edge | 2.731 | 64 | 12.72 | yes | ML scorer | 1.468 | 30 | 2.731 | 64 | Medium |
| 30 | competition_sp_500_futures_daily_tsmom_next_overnight_weekday_side_1_long_c8bb041e | sp_500_futures | competition_session_edge | 2.729 | 82 | 91.89 | yes | ML scorer | 1.218 | 171 | 2.729 | 82 | Low |
| 31 | competition_eur_cad_london_first30_last30_momentum_month_8_c5f12647 | eur_cad | competition_session_edge | 2.726 | 87 | 23.04 | yes | ML scorer | 1.290 | 39 | 2.726 | 87 | Medium |
| 32 | competition_usd_jpy_overnight_close_to_open_bias_long_month_10_06e957d5 | usd_jpy | competition_session_edge | 2.669 | 89 | 177.85 | yes | ML scorer | 0.927 | 48 | 2.669 | 89 | Medium |
| 33 | competition_silver_futures_daily_tsmom_next_overnight_weekday_side_1_long_f61a84dd | silver_futures | competition_session_edge | 2.668 | 87 | 170.52 | yes | ML scorer | 0.908 | 315 | 2.668 | 87 | Low |
| 34 | competition_eur_jpy_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_563aa3f1 | eur_jpy | competition_session_edge | 2.667 | 68 | 105.44 | yes | ML scorer | 1.708 | 44 | 2.667 | 68 | Medium |
| 35 | competition_sp_500_futures_us_first30_last30_reversal_weekday_side_0_long_2b2acc93 | sp_500_futures | competition_session_edge | 2.663 | 59 | 33.83 | yes | ML scorer | 1.269 | 209 | 2.663 | 59 | Low |
| 36 | competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_2_short_99ba7153 | dow_jones_futures | competition_session_edge | 2.640 | 83 | 102.63 | yes | ML scorer | 0.677 | 194 | 2.640 | 83 | Low |
| 37 | competition_usd_cad_us_first30_last30_momentum_signalmonth_direction_same_entryminute_930_exitbarminut_c1317995 | usd_cad | competition_session_edge | 2.637 | 108 | 39.78 | yes | ML scorer | 1.021 | 43 | 2.637 | 108 | Medium |
| 38 | competition_british_pound_futures_us_first30_last30_reversal_month_10_57755118 | british_pound_futures | competition_session_edge | 2.627 | 57 | 11.61 | yes | ML scorer | 0.997 | 151 | 2.627 | 57 | Low |
| 39 | competition_gbp_jpy_london_first30_ny_open_reversal_signalmonth_direction_opposite_entryminute_480_exi_d549e3a7 | gbp_jpy | competition_session_edge | 2.599 | 59 | 46.42 | yes | ML scorer | 1.503 | 31 | 2.599 | 59 | Medium |
| 40 | competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_dcd12f25 | australian_dollar_futures | competition_session_edge | 2.596 | 75 | 82.37 | yes | ML scorer | 1.396 | 154 | 2.596 | 75 | Low |
| 41 | competition_russell_2000_futures_daily_tsmom_next_overnight_month_7_d15e8a17 | russell_2000_futures | competition_session_edge | 2.555 | 81 | 85.32 | yes | ML scorer | 1.016 | 90 | 2.555 | 81 | Low |
| 42 | competition_crude_oil_futures_us_first30_midday_momentum_month_4_32a2fef5 | crude_oil_futures | competition_session_edge | 2.538 | 102 | 50.54 | yes | ML scorer | 0.979 | 222 | 2.538 | 102 | Low |
| 43 | competition_us_treasury_2y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_339e7451 | us_treasury_2y_note_futures | competition_session_edge | 2.520 | 66 | 15.15 | yes | ML scorer | 1.282 | 42 | 2.520 | 66 | Medium |
| 44 | competition_nasdaq_100_futures_daily_tsmom_next_overnight_weekday_side_1_long_8e593f24 | nasdaq_100_futures | competition_session_edge | 2.519 | 83 | 87.91 | yes | ML scorer | 1.117 | 185 | 2.519 | 83 | Low |
| 45 | competition_gbp_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_9b2547fb | gbp_usd | competition_session_edge | 2.515 | 57 | 11.31 | yes | ML scorer | 1.166 | 27 | 2.515 | 57 | Medium |
| 46 | competition_usd_chf_us_first30_midday_reversal_month_1_074f7113 | usd_chf | competition_session_edge | 2.500 | 110 | 44.37 | yes | ML scorer | 0.499 | 23 | 2.500 | 110 | Medium |
| 47 | competition_aud_usd_daily_tsmom_next_overnight_month_12_45e372f3 | aud_usd | competition_session_edge | 2.498 | 79 | 137.91 | yes | ML scorer | 1.726 | 53 | 2.498 | 79 | Low |
| 48 | competition_eur_usd_daily_tsmom_next_overnight_month_1_33ed35ff | eur_usd | competition_session_edge | 2.456 | 100 | 172.39 | yes | ML scorer | 0.665 | 25 | 2.456 | 100 | Medium |
| 49 | competition_silver_futures_london_first30_ny_open_momentum_weekday_side_0_short_7456f9c2 | silver_futures | competition_session_edge | 2.454 | 90 | 97.56 | yes | ML scorer | 0.761 | 300 | 2.454 | 90 | Low |
| 50 | competition_swiss_franc_futures_overnight_close_to_open_bias_short_month_10_17716ea5 | swiss_franc_futures | competition_session_edge | 2.422 | 89 | 135.03 | yes | ML scorer | 0.607 | 43 | 2.422 | 89 | Medium |
| 51 | competition_euro_futures_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitmin_0b54da46 | euro_futures | competition_session_edge | 2.398 | 62 | 80.96 | yes | ML scorer | 1.293 | 243 | 2.398 | 62 | Low |
| 52 | competition_eur_jpy_us_first30_midday_momentum_month_8_95ae5d8c | eur_jpy | competition_session_edge | 2.397 | 57 | 17.41 | yes | ML scorer | 0.908 | 23 | 2.397 | 57 | Medium |
| 53 | competition_gbp_jpy_us_first30_last30_momentum_weekday_side_2_long_461ef776 | gbp_jpy | competition_session_edge | 2.397 | 68 | 9.74 | yes | ML scorer | 0.652 | 33 | 2.397 | 68 | Medium |
| 54 | competition_british_pound_futures_daily_tsmom_next_overnight_month_7_da1c691c | british_pound_futures | competition_session_edge | 2.395 | 87 | 186.69 | yes | ML scorer | 1.161 | 254 | 2.395 | 87 | Low |
| 55 | competition_eur_usd_overnight_close_to_open_bias_long_month_12_8a49b98f | eur_usd | competition_session_edge | 2.391 | 73 | 84.44 | yes | ML scorer | 1.447 | 49 | 2.391 | 73 | Medium |
| 56 | competition_british_pound_futures_london_first30_last30_reversal_month_1_c3526d80 | british_pound_futures | competition_session_edge | 2.389 | 78 | 18.06 | yes | ML scorer | 1.429 | 158 | 2.389 | 78 | Low |
| 57 | competition_nzd_usd_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitminute_9_183b1d88 | nzd_usd | competition_session_edge | 2.382 | 100 | 138.98 | yes | ML scorer | 1.165 | 33 | 2.382 | 100 | Medium |
| 58 | competition_australian_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entrym_77aa2b55 | australian_dollar_futures | competition_session_edge | 2.361 | 61 | 10.98 | yes | ML scorer | 1.372 | 165 | 2.361 | 61 | Low |
| 59 | competition_aud_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_c8c5223e | aud_usd | competition_session_edge | 2.357 | 60 | 10.33 | yes | ML scorer | 1.556 | 34 | 2.357 | 60 | Medium |
| 60 | competition_micro_bitcoin_futures_daily_tsmom_next_rth_weekday_side_2_short_4be5774f | micro_bitcoin_futures | competition_session_edge | 2.356 | 101 | 182.26 | yes | ML scorer | 1.185 | 19 | 2.356 | 101 | High |
| 61 | competition_eur_chf_us_first30_midday_momentum_month_6_f4946f20 | eur_chf | competition_session_edge | 2.349 | 59 | 15.63 | yes | ML scorer | 0.923 | 30 | 2.349 | 59 | Medium |
| 62 | competition_aud_usd_london_first30_ny_open_momentum_month_4_6674a830 | aud_usd | competition_session_edge | 2.341 | 103 | 91.07 | yes | ML scorer | 1.412 | 41 | 2.341 | 103 | Medium |
| 63 | competition_swiss_franc_futures_us_first30_midday_momentum_month_5_a2abc7dd | swiss_franc_futures | competition_session_edge | 2.340 | 91 | 31.51 | yes | ML scorer | 3.038 | 38 | 2.340 | 91 | Medium |
| 64 | competition_gbp_jpy_us_first30_last30_reversal_weekday_side_2_long_bfe5c772 | gbp_jpy | competition_session_edge | 2.337 | 118 | 21.43 | yes | ML scorer | 0.690 | 49 | 2.337 | 118 | Medium |
| 65 | competition_canadian_dollar_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entrymin_eee85315 | canadian_dollar_futures | competition_session_edge | 2.327 | 82 | 85.76 | yes | ML scorer | 1.461 | 243 | 2.327 | 82 | Low |
| 66 | competition_gbp_jpy_daily_tsmom_next_overnight_month_10_74426304 | gbp_jpy | competition_session_edge | 2.316 | 89 | 212.62 | yes | ML scorer | 0.957 | 49 | 2.316 | 89 | Medium |
| 67 | competition_gold_futures_daily_tsmom_next_overnight_weekday_side_3_long_648d544b | gold_futures | competition_session_edge | 2.247 | 79 | 177.80 | yes | ML scorer | 1.470 | 284 | 2.247 | 79 | Low |
| 68 | competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_4_short_72a8080e | us_treasury_30y_bond_futures | competition_session_edge | 2.240 | 96 | 57.04 | yes | ML scorer | 1.450 | 293 | 2.240 | 96 | Low |
| 69 | competition_sp_500_futures_daily_tsmom_next_overnight_weekday_side_2_short_af21c53b | sp_500_futures | competition_session_edge | 2.237 | 81 | 81.00 | yes | ML scorer | 0.750 | 174 | 2.237 | 81 | Low |
| 70 | competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_1aa4fa28 | australian_dollar_futures | competition_session_edge | 2.236 | 65 | 75.91 | yes | ML scorer | 1.514 | 204 | 2.236 | 65 | Low |
| 71 | competition_eur_jpy_us_first30_last30_reversal_weekday_side_4_long_6d672b02 | eur_jpy | competition_session_edge | 2.226 | 49 | 6.73 | yes | ML scorer | 1.806 | 30 | 2.226 | 49 | Medium |
| 72 | competition_gbp_usd_daily_tsmom_next_overnight_month_7_1cefc684 | gbp_usd | competition_session_edge | 2.217 | 88 | 172.49 | yes | ML scorer | 1.262 | 48 | 2.217 | 88 | Medium |
| 73 | competition_us_treasury_2y_note_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_ex_d2289e05 | us_treasury_2y_note_futures | competition_session_edge | 2.216 | 62 | 36.33 | yes | ML scorer | 1.496 | 34 | 2.216 | 62 | Medium |
| 74 | competition_us_treasury_5y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_62e3b6d2 | us_treasury_5y_note_futures | competition_session_edge | 2.215 | 99 | 18.44 | yes | ML scorer | 1.383 | 55 | 2.215 | 99 | Low |
| 75 | competition_us_treasury_10y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_7240deca | us_treasury_10y_note_futures | competition_session_edge | 2.214 | 96 | 53.28 | yes | ML scorer | 1.375 | 290 | 2.214 | 96 | Low |
| 76 | competition_dow_jones_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entrymin_c2a8817b | dow_jones_futures | competition_session_edge | 2.210 | 132 | 134.34 | yes | ML scorer | 1.414 | 376 | 2.210 | 132 | Low |
| 77 | competition_silver_futures_london_first30_ny_open_momentum_signalweekdayside_direction_same_entryminut_5ce60b39 | silver_futures | competition_session_edge | 2.202 | 80 | 92.15 | yes | ML scorer | 1.368 | 215 | 2.202 | 80 | Low |
| 78 | competition_aud_usd_daily_tsmom_next_overnight_month_6_c0c3d057 | aud_usd | competition_session_edge | 2.198 | 84 | 152.50 | yes | ML scorer | 0.498 | 51 | 2.198 | 84 | Low |
| 79 | competition_usd_cad_us_first30_midday_reversal_month_12_1f6382c6 | usd_cad | competition_session_edge | 2.192 | 61 | 26.82 | yes | ML scorer | 1.949 | 27 | 2.192 | 61 | Medium |
| 80 | competition_usd_jpy_asia_range_london_breakout_signalweekdayside_breakendminute_360_breakstartminute_1_83470b07 | usd_jpy | competition_session_edge | 2.188 | 87 | 20.16 | yes | ML scorer | 1.902 | 40 | 2.188 | 87 | Medium |
| 81 | competition_eur_jpy_daily_tsmom_next_overnight_weekday_side_2_short_bad001bc | eur_jpy | competition_session_edge | 2.184 | 142 | 308.05 | yes | ML scorer | 0.860 | 57 | 2.184 | 142 | Low |
| 82 | competition_nzd_usd_us_first30_midday_momentum_month_4_f022fff9 | nzd_usd | competition_session_edge | 2.162 | 73 | 25.01 | yes | ML scorer | 0.677 | 33 | 2.162 | 73 | Medium |
| 83 | competition_eur_gbp_london_first30_ny_open_reversal_weekday_side_4_long_97b8e7c1 | eur_gbp | competition_session_edge | 2.161 | 70 | 43.42 | yes | ML scorer | 0.857 | 35 | 2.161 | 70 | Medium |
| 84 | competition_usd_jpy_london_first30_ny_open_reversal_month_9_17887f0e | usd_jpy | competition_session_edge | 2.159 | 68 | 47.92 | yes | ML scorer | 0.992 | 37 | 2.159 | 68 | Medium |
| 85 | competition_eur_jpy_daily_tsmom_next_overnight_weekday_side_4_long_f8ec3c41 | eur_jpy | competition_session_edge | 2.153 | 135 | 94.39 | yes | ML scorer | 0.421 | 50 | 2.153 | 135 | Low |
| 86 | competition_gbp_jpy_ny_open_gap_follow_month_9_eea6b89e | gbp_jpy | competition_session_edge | 2.152 | 68 | 53.40 | yes | ML scorer | 1.178 | 40 | 2.152 | 68 | Medium |
| 87 | competition_gold_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entryminute_9_c8e1caae | gold_futures | competition_session_edge | 2.144 | 116 | 163.48 | yes | ML scorer | 1.392 | 311 | 2.144 | 116 | Low |
| 88 | competition_aud_nzd_london_first30_last30_reversal_weekday_side_0_long_2e0ed4d2 | aud_nzd | competition_session_edge | 2.133 | 53 | 6.97 | yes | ML scorer | 0.591 | 28 | 2.133 | 53 | Medium |
| 89 | nasdaq_100_futures_round_hundred_rejection_15m | nasdaq_100_futures | round_number_rejection | 2.123 | 54 | 31.73 | yes | Decision stump | 0.713 | 152 | 2.017 | 53 | Low |
| 90 | competition_japanese_yen_futures_london_first30_ny_open_reversal_month_9_6d9e482f | japanese_yen_futures | competition_session_edge | 2.117 | 69 | 48.51 | yes | ML scorer | 1.069 | 189 | 2.117 | 69 | Low |
| 91 | competition_nzd_usd_london_first30_ny_open_momentum_month_4_cfddb747 | nzd_usd | competition_session_edge | 2.112 | 102 | 91.46 | yes | ML scorer | 1.075 | 40 | 2.112 | 102 | Medium |
| 92 | competition_usd_cad_daily_tsmom_next_overnight_month_10_941ee263 | usd_cad | competition_session_edge | 2.103 | 89 | 81.82 | yes | ML scorer | 0.664 | 47 | 2.103 | 89 | Medium |
| 93 | competition_us_treasury_2y_note_futures_us_first30_last30_momentum_weekday_side_3_long_6989e3fd | us_treasury_2y_note_futures | competition_session_edge | 2.101 | 91 | 15.69 | yes | ML scorer | 0.617 | 36 | 2.101 | 91 | Medium |
| 94 | competition_eur_gbp_us_first30_last30_reversal_weekday_side_1_short_2371b8e4 | eur_gbp | competition_session_edge | 2.086 | 73 | 8.65 | yes | ML scorer | 0.568 | 30 | 2.086 | 73 | Medium |
| 95 | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | aud_usd | competition_session_edge | 2.082 | 65 | 56.62 | yes | ML scorer | 1.254 | 40 | 2.082 | 65 | Medium |
| 96 | competition_us_treasury_10y_note_futures_us_first30_last30_momentum_weekday_side_2_long_014bd88f | us_treasury_10y_note_futures | competition_session_edge | 2.078 | 105 | 20.47 | yes | ML scorer | 1.385 | 274 | 2.078 | 105 | Low |
| 97 | competition_new_zealand_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exi_7ad85d81 | new_zealand_dollar_futures | competition_session_edge | 2.070 | 79 | 62.42 | yes | ML scorer | 1.093 | 28 | 2.070 | 79 | Medium |
| 98 | competition_eur_chf_daily_tsmom_next_overnight_weekday_side_2_short_15ab1798 | eur_chf | competition_session_edge | 2.067 | 97 | 150.81 | yes | ML scorer | 1.618 | 40 | 2.067 | 97 | Medium |
| 99 | competition_gbp_jpy_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_945_ming_297a7a1d | gbp_jpy | competition_session_edge | 2.054 | 100 | 117.18 | yes | ML scorer | 2.109 | 23 | 2.054 | 100 | Medium |
| 100 | competition_eur_gbp_us_first30_midday_reversal_month_5_da8593e8 | eur_gbp | competition_session_edge | 2.046 | 70 | 16.57 | yes | ML scorer | 0.843 | 29 | 2.046 | 70 | Medium |
| 101 | competition_eur_jpy_london_first30_ny_open_reversal_month_9_ef673bbe | eur_jpy | competition_session_edge | 2.044 | 84 | 44.99 | yes | ML scorer | 0.948 | 44 | 2.044 | 84 | Medium |
| 102 | competition_gbp_jpy_london_first30_ny_open_momentum_weekday_side_3_short_d1634235 | gbp_jpy | competition_session_edge | 2.044 | 75 | 64.44 | yes | ML scorer | 1.352 | 30 | 2.044 | 75 | Medium |
| 103 | competition_gbp_usd_london_first30_last30_reversal_month_1_dc2945a5 | gbp_usd | competition_session_edge | 2.039 | 80 | 16.20 | yes | ML scorer | 0.414 | 18 | 2.039 | 80 | High |
| 104 | competition_eur_chf_ny_open_gap_fade_month_9_5044d21c | eur_chf | competition_session_edge | 2.035 | 64 | 32.27 | yes | ML scorer | 0.890 | 39 | 2.035 | 64 | Medium |
| 105 | competition_gbp_jpy_daily_tsmom_next_overnight_signalmonth_direction_contrarian_entryminute_945_exitmi_ab520ea7 | gbp_jpy | competition_session_edge | 2.016 | 86 | 134.57 | yes | ML scorer | 3.219 | 39 | 2.016 | 86 | Medium |
| 106 | competition_nasdaq_100_futures_london_first30_ny_open_momentum_weekday_side_3_short_726e6c71 | nasdaq_100_futures | competition_session_edge | 2.014 | 109 | 117.31 | yes | ML scorer | 0.946 | 294 | 2.014 | 109 | Low |
| 107 | competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_0_long_157ef9f4 | us_treasury_30y_bond_futures | competition_session_edge | 2.014 | 75 | 90.33 | yes | ML scorer | 1.067 | 288 | 2.014 | 75 | Low |
| 108 | competition_copper_futures_daily_tsmom_next_overnight_weekday_side_1_long_28c520df | copper_futures | competition_session_edge | 2.014 | 101 | 245.01 | yes | ML scorer | 0.964 | 295 | 2.014 | 101 | Low |
| 109 | competition_copper_futures_us_first30_last30_reversal_weekday_side_4_short_79163bfe | copper_futures | competition_session_edge | 2.010 | 69 | 6.23 | yes | ML scorer | 0.813 | 177 | 2.010 | 69 | Low |
| 110 | competition_corn_futures_london_first30_ny_open_reversal_weekday_side_3_short_bd97e9a5 | corn_futures | competition_session_edge | 2.002 | 100 | 103.97 | yes | ML scorer | 0.939 | 38 | 2.002 | 100 | Medium |

## Overfit Notes

- **#1 competition_japanese_yen_futures_us_first30_last30_reversal_signalweekdayside_direction_opposite_entry_11a69e11**: Low - forward stronger than fit sample
- **#2 competition_usd_jpy_us_first30_last30_reversal_signalweekdayside_direction_opposite_entryminute_930_ex_40e6d9ae**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#3 competition_micro_ether_futures_daily_tsmom_next_overnight_weekday_side_1_long_dc4c34f3**: High - thin pre-split sample; forward stronger than fit sample
- **#4 competition_micro_ether_futures_london_first30_ny_open_momentum_weekday_side_3_short_e779cb85**: High - thin pre-split sample; large PF decay
- **#5 competition_micro_bitcoin_futures_daily_tsmom_next_overnight_signalweekdayside_direction_contrarian_en_6003fc2d**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#6 competition_new_zealand_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entry_ce284576**: Medium - small total sample; forward stronger than fit sample
- **#7 competition_eur_jpy_us_first30_last30_momentum_signalweekdayside_direction_same_entryminute_930_exitba_0a4a3f58**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#8 competition_crude_oil_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exit_ny_o_315d7644**: Low - forward stronger than fit sample
- **#9 competition_eur_chf_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_391afa4a**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#10 competition_corn_futures_us_first30_midday_momentum_weekday_side_3_long_cbe1149a**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#11 competition_usd_chf_daily_tsmom_next_overnight_month_12_4f2024c0**: Low - forward stronger than fit sample
- **#12 competition_natural_gas_futures_us_first30_last30_momentum_month_9_c678e3c1**: Low - forward stronger than fit sample
- **#13 competition_us_treasury_2y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_e133c7a3**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#14 competition_micro_ether_futures_london_first30_ny_open_reversal_weekday_side_0_long_d64af48a**: High - small total sample; thin pre-split sample; forward stronger than fit sample
- **#15 competition_usd_cad_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminute_945_exitminu_dca02dc1**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#16 competition_us_treasury_5y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_6dc543f7**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#17 competition_copper_futures_us_first30_last30_reversal_weekday_side_0_long_04d98061**: Low - forward stronger than fit sample
- **#18 competition_gbp_jpy_daily_tsmom_next_rth_month_6_4be2e72e**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#19 competition_us_treasury_5y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_1942c62b**: Medium - ML fit sample under 50 trades
- **#20 competition_japanese_yen_futures_overnight_close_to_open_bias_short_month_10_6bc43a25**: Low - forward stronger than fit sample
- **#21 competition_russell_2000_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarmi_801e97d2**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#22 competition_canadian_dollar_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exi_31e5e01a**: Low - forward stronger than fit sample
- **#23 competition_gbp_jpy_london_first30_last30_momentum_weekday_side_4_long_6a554e5f**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#24 competition_gold_futures_us_first30_last30_reversal_weekday_side_0_long_c0163084**: Low - forward stronger than fit sample
- **#25 competition_usd_cad_london_first30_ny_open_momentum_month_12_f0df56f8**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#26 competition_eur_cad_us_first30_midday_momentum_month_10_8e114485**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#27 gbp_usd_ny_sweep_bayes**: Medium - no true train/forward metadata; small total sample; thin post-split sample
- **#28 competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#29 competition_gbp_jpy_london_first30_last30_reversal_weekday_side_4_long_ef0c2df3**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#30 competition_sp_500_futures_daily_tsmom_next_overnight_weekday_side_1_long_c8bb041e**: Low - forward stronger than fit sample
- **#31 competition_eur_cad_london_first30_last30_momentum_month_8_c5f12647**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#32 competition_usd_jpy_overnight_close_to_open_bias_long_month_10_06e957d5**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#33 competition_silver_futures_daily_tsmom_next_overnight_weekday_side_1_long_f61a84dd**: Low - forward stronger than fit sample
- **#34 competition_eur_jpy_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_563aa3f1**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#35 competition_sp_500_futures_us_first30_last30_reversal_weekday_side_0_long_2b2acc93**: Low - forward stronger than fit sample
- **#36 competition_dow_jones_futures_daily_tsmom_next_overnight_weekday_side_2_short_99ba7153**: Low - forward stronger than fit sample
- **#37 competition_usd_cad_us_first30_last30_momentum_signalmonth_direction_same_entryminute_930_exitbarminut_c1317995**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#38 competition_british_pound_futures_us_first30_last30_reversal_month_10_57755118**: Low - forward stronger than fit sample
- **#39 competition_gbp_jpy_london_first30_ny_open_reversal_signalmonth_direction_opposite_entryminute_480_exi_d549e3a7**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#40 competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_dcd12f25**: Low - forward stronger than fit sample
- **#41 competition_russell_2000_futures_daily_tsmom_next_overnight_month_7_d15e8a17**: Low - forward stronger than fit sample
- **#42 competition_crude_oil_futures_us_first30_midday_momentum_month_4_32a2fef5**: Low - forward stronger than fit sample
- **#43 competition_us_treasury_2y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_339e7451**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#44 competition_nasdaq_100_futures_daily_tsmom_next_overnight_weekday_side_1_long_8e593f24**: Low - forward stronger than fit sample
- **#45 competition_gbp_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_9b2547fb**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#46 competition_usd_chf_us_first30_midday_reversal_month_1_074f7113**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#47 competition_aud_usd_daily_tsmom_next_overnight_month_12_45e372f3**: Low - forward stronger than fit sample
- **#48 competition_eur_usd_daily_tsmom_next_overnight_month_1_33ed35ff**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#49 competition_silver_futures_london_first30_ny_open_momentum_weekday_side_0_short_7456f9c2**: Low - forward stronger than fit sample
- **#50 competition_swiss_franc_futures_overnight_close_to_open_bias_short_month_10_17716ea5**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#51 competition_euro_futures_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitmin_0b54da46**: Low - forward stronger than fit sample
- **#52 competition_eur_jpy_us_first30_midday_momentum_month_8_95ae5d8c**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#53 competition_gbp_jpy_us_first30_last30_momentum_weekday_side_2_long_461ef776**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#54 competition_british_pound_futures_daily_tsmom_next_overnight_month_7_da1c691c**: Low - forward stronger than fit sample
- **#55 competition_eur_usd_overnight_close_to_open_bias_long_month_12_8a49b98f**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#56 competition_british_pound_futures_london_first30_last30_reversal_month_1_c3526d80**: Low - forward stronger than fit sample
- **#57 competition_nzd_usd_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitminute_9_183b1d88**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#58 competition_australian_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entrym_77aa2b55**: Low - forward stronger than fit sample
- **#59 competition_aud_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_c8c5223e**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#60 competition_micro_bitcoin_futures_daily_tsmom_next_rth_weekday_side_2_short_4be5774f**: High - thin pre-split sample; forward stronger than fit sample
- **#61 competition_eur_chf_us_first30_midday_momentum_month_6_f4946f20**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#62 competition_aud_usd_london_first30_ny_open_momentum_month_4_6674a830**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#63 competition_swiss_franc_futures_us_first30_midday_momentum_month_5_a2abc7dd**: Medium - ML fit sample under 50 trades
- **#64 competition_gbp_jpy_us_first30_last30_reversal_weekday_side_2_long_bfe5c772**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#65 competition_canadian_dollar_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entrymin_eee85315**: Low - forward stronger than fit sample
- **#66 competition_gbp_jpy_daily_tsmom_next_overnight_month_10_74426304**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#67 competition_gold_futures_daily_tsmom_next_overnight_weekday_side_3_long_648d544b**: Low - forward stronger than fit sample
- **#68 competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_4_short_72a8080e**: Low - forward stronger than fit sample
- **#69 competition_sp_500_futures_daily_tsmom_next_overnight_weekday_side_2_short_af21c53b**: Low - forward stronger than fit sample
- **#70 competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_1aa4fa28**: Low - forward stronger than fit sample
- **#71 competition_eur_jpy_us_first30_last30_reversal_weekday_side_4_long_6d672b02**: Medium - small total sample
- **#72 competition_gbp_usd_daily_tsmom_next_overnight_month_7_1cefc684**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#73 competition_us_treasury_2y_note_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_ex_d2289e05**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#74 competition_us_treasury_5y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_62e3b6d2**: Low - forward stronger than fit sample
- **#75 competition_us_treasury_10y_note_futures_daily_tsmom_next_overnight_weekday_side_4_short_7240deca**: Low - forward stronger than fit sample
- **#76 competition_dow_jones_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entrymin_c2a8817b**: Low - forward stronger than fit sample
- **#77 competition_silver_futures_london_first30_ny_open_momentum_signalweekdayside_direction_same_entryminut_5ce60b39**: Low - forward stronger than fit sample
- **#78 competition_aud_usd_daily_tsmom_next_overnight_month_6_c0c3d057**: Low - forward stronger than fit sample
- **#79 competition_usd_cad_us_first30_midday_reversal_month_12_1f6382c6**: Medium - ML fit sample under 50 trades
- **#80 competition_usd_jpy_asia_range_london_breakout_signalweekdayside_breakendminute_360_breakstartminute_1_83470b07**: Medium - ML fit sample under 50 trades
- **#81 competition_eur_jpy_daily_tsmom_next_overnight_weekday_side_2_short_bad001bc**: Low - forward stronger than fit sample
- **#82 competition_nzd_usd_us_first30_midday_momentum_month_4_f022fff9**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#83 competition_eur_gbp_london_first30_ny_open_reversal_weekday_side_4_long_97b8e7c1**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#84 competition_usd_jpy_london_first30_ny_open_reversal_month_9_17887f0e**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#85 competition_eur_jpy_daily_tsmom_next_overnight_weekday_side_4_long_f8ec3c41**: Low - forward stronger than fit sample
- **#86 competition_gbp_jpy_ny_open_gap_follow_month_9_eea6b89e**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#87 competition_gold_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entryminute_9_c8e1caae**: Low - forward stronger than fit sample
- **#88 competition_aud_nzd_london_first30_last30_reversal_weekday_side_0_long_2e0ed4d2**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#89 nasdaq_100_futures_round_hundred_rejection_15m**: Low - forward stronger than fit sample
- **#90 competition_japanese_yen_futures_london_first30_ny_open_reversal_month_9_6d9e482f**: Low - forward stronger than fit sample
- **#91 competition_nzd_usd_london_first30_ny_open_momentum_month_4_cfddb747**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#92 competition_usd_cad_daily_tsmom_next_overnight_month_10_941ee263**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#93 competition_us_treasury_2y_note_futures_us_first30_last30_momentum_weekday_side_3_long_6989e3fd**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#94 competition_eur_gbp_us_first30_last30_reversal_weekday_side_1_short_2371b8e4**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#95 competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#96 competition_us_treasury_10y_note_futures_us_first30_last30_momentum_weekday_side_2_long_014bd88f**: Low - forward stronger than fit sample
- **#97 competition_new_zealand_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exi_7ad85d81**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#98 competition_eur_chf_daily_tsmom_next_overnight_weekday_side_2_short_15ab1798**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#99 competition_gbp_jpy_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_945_ming_297a7a1d**: Medium - ML fit sample under 50 trades
- **#100 competition_eur_gbp_us_first30_midday_reversal_month_5_da8593e8**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#101 competition_eur_jpy_london_first30_ny_open_reversal_month_9_ef673bbe**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#102 competition_gbp_jpy_london_first30_ny_open_momentum_weekday_side_3_short_d1634235**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#103 competition_gbp_usd_london_first30_last30_reversal_month_1_dc2945a5**: High - thin pre-split sample; forward stronger than fit sample
- **#104 competition_eur_chf_ny_open_gap_fade_month_9_5044d21c**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
- **#105 competition_gbp_jpy_daily_tsmom_next_overnight_signalmonth_direction_contrarian_entryminute_945_exitmi_ab520ea7**: Medium - moderate PF decay
- **#106 competition_nasdaq_100_futures_london_first30_ny_open_momentum_weekday_side_3_short_726e6c71**: Low - forward stronger than fit sample
- **#107 competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_0_long_157ef9f4**: Low - forward stronger than fit sample
- **#108 competition_copper_futures_daily_tsmom_next_overnight_weekday_side_1_long_28c520df**: Low - forward stronger than fit sample
- **#109 competition_copper_futures_us_first30_last30_reversal_weekday_side_4_short_79163bfe**: Low - forward stronger than fit sample
- **#110 competition_corn_futures_london_first30_ny_open_reversal_weekday_side_3_short_bd97e9a5**: Medium - forward stronger than fit sample; ML fit sample under 50 trades
