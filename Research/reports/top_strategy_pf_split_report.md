# High-Confidence Strategy Selection

Generated from completed strict backtest CSVs at the restored `publish-main`/`main` branch state.

## Result

- Selected: 36 strategies (15 forex, 21 futures).
- Target: 50 forex and 50 futures.
- Shortfall: 35 forex and 29 futures.
- Qualified before exact-trade de-duplication: 82 (41 forex, 41 futures).
- Rule rejections: 59.
- Missing/unfinished trade CSVs: 66.
- Exact-overlap duplicate rejections: 46.

## Gates

- Overall profit factor > 2.0.
- At least 20 trades.
- 4 chronological quarters, each with at least 5 trades.
- Every chronological quarter must have PF > 1.0.
- Strategies on the same asset may not share any exact trade signature `(asset, side, entry_time)`.
- Per-asset selection maximizes count first, then robustness score.

## Selected

| Rank | Market | Symbol | Strategy | PF | Trades | Min Quarter PF | Bootstrap PF p05 |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | forex | USDJPY | `competition_usd_jpy_us_first30_last30_reversal_signalweekdayside_direction_opposite_entryminute_930_ex_40e6d9ae` | 3.984448 | 74 | 2.545385 | 2.361974 |
| 2 | forex | EURCHF | `competition_eur_chf_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_391afa4a` | 3.220641 | 94 | 2.986694 | 1.679923 |
| 3 | forex | EURJPY | `competition_eur_jpy_us_first30_last30_momentum_signalweekdayside_direction_same_entryminute_930_exitba_0a4a3f58` | 3.430396 | 64 | 2.681117 | 1.957779 |
| 4 | forex | USDCAD | `competition_usd_cad_daily_tsmom_next_overnight_signalmonth_direction_momentum_entryminute_945_exitminu_dca02dc1` | 3.022206 | 74 | 2.069056 | 1.654965 |
| 5 | forex | USDCAD | `competition_usd_cad_us_first30_last30_momentum_signalmonth_direction_same_entryminute_930_exitbarminut_c1317995` | 2.637082 | 108 | 1.921319 | 1.506705 |
| 6 | forex | USDJPY | `competition_usd_jpy_asia_range_london_breakout_signalweekdayside_breakendminute_360_breakstartminute_1_83470b07` | 2.188032 | 87 | 2.022736 | 1.396223 |
| 7 | forex | EURJPY | `competition_eur_jpy_daily_tsmom_next_rth_signalmonth_direction_momentum_entryminute_570_exitminute_945_563aa3f1` | 2.667123 | 68 | 1.496442 | 1.620477 |
| 8 | forex | GBPJPY | `competition_gbp_jpy_london_first30_ny_open_reversal_signalmonth_direction_opposite_entryminute_480_exi_d549e3a7` | 2.598616 | 59 | 1.524627 | 1.573853 |
| 9 | forex | NZDUSD | `competition_nzd_usd_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitminute_9_183b1d88` | 2.382285 | 100 | 1.114924 | 1.376309 |
| 10 | forex | AUDUSD | `aud_usd_ny_sweep_bayes` | 2.144915 | 64 | 1.546397 | 1.401278 |
| 11 | forex | GBPJPY | `competition_gbp_jpy_daily_tsmom_next_overnight_signalmonth_direction_contrarian_entryminute_945_exitmi_ab520ea7` | 2.016196 | 86 | 1.510196 | 1.178731 |
| 12 | forex | GBPJPY | `competition_gbp_jpy_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_945_ming_297a7a1d` | 2.053985 | 100 | 1.076423 | 1.277133 |
| 13 | forex | AUDUSD | `competition_aud_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_c8c5223e` | 2.357436 | 60 | 1.237057 | 1.255583 |
| 14 | forex | GBPUSD | `competition_gbp_usd_us_first30_last30_reversal_signalmonth_direction_opposite_entryminute_930_exitbarm_9b2547fb` | 2.514715 | 57 | 1.100484 | 1.253855 |
| 15 | forex | AUDUSD | `competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e` | 2.082419 | 65 | 1.093491 | 1.161481 |
| 16 | futures | 6J | `competition_japanese_yen_futures_us_first30_last30_reversal_signalweekdayside_direction_opposite_entry_11a69e11` | 4.349795 | 75 | 3.333813 | 2.533815 |
| 17 | futures | MBT | `competition_micro_bitcoin_futures_daily_tsmom_next_overnight_signalweekdayside_direction_contrarian_en_6003fc2d` | 3.553443 | 104 | 3.253263 | 2.366515 |
| 18 | futures | CL | `competition_crude_oil_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exit_ny_o_315d7644` | 3.231682 | 102 | 2.603495 | 1.987660 |
| 19 | futures | RTY | `competition_russell_2000_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarmi_801e97d2` | 2.853419 | 59 | 2.415245 | 1.771335 |
| 20 | futures | 6A | `competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_dcd12f25` | 2.596410 | 75 | 2.203902 | 1.612131 |
| 21 | futures | 6C | `competition_canadian_dollar_futures_overnight_close_to_open_bias_signalmonth_entry_prior_rth_close_exi_31e5e01a` | 2.850315 | 89 | 1.404705 | 1.789772 |
| 22 | futures | ZF | `competition_us_treasury_5y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_1942c62b` | 2.883844 | 74 | 1.580397 | 1.630931 |
| 23 | futures | YM | `competition_dow_jones_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entrymin_c2a8817b` | 2.210431 | 132 | 1.618157 | 1.515133 |
| 24 | futures | 6N | `competition_new_zealand_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entry_ce284576` | 3.449856 | 48 | 1.017082 | 1.797018 |
| 25 | futures | ZT | `competition_us_treasury_2y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_339e7451` | 2.519809 | 66 | 1.541739 | 1.443001 |
| 26 | futures | GC | `competition_gold_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entryminute_9_c8e1caae` | 2.143666 | 116 | 1.333561 | 1.359312 |
| 27 | futures | 6N | `competition_new_zealand_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exi_7ad85d81` | 2.069898 | 79 | 1.740724 | 1.304199 |
| 28 | futures | 6E | `competition_euro_futures_daily_tsmom_next_rth_signalmonth_direction_contrarian_entryminute_570_exitmin_0b54da46` | 2.398338 | 62 | 1.623853 | 1.271421 |
| 29 | futures | ZF | `competition_us_treasury_5y_note_futures_us_first30_last30_momentum_signalweekdayside_direction_same_en_62e3b6d2` | 2.214931 | 99 | 1.194064 | 1.320105 |
| 30 | futures | 6C | `competition_canadian_dollar_futures_daily_tsmom_next_overnight_signalmonth_direction_momentum_entrymin_eee85315` | 2.327248 | 82 | 1.207398 | 1.325801 |
| 31 | futures | 6A | `competition_australian_dollar_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exit_1aa4fa28` | 2.235863 | 65 | 1.452598 | 1.168790 |
| 32 | futures | SI | `competition_silver_futures_london_first30_ny_open_momentum_signalweekdayside_direction_same_entryminut_5ce60b39` | 2.201532 | 80 | 1.106088 | 1.311121 |
| 33 | futures | 6A | `competition_australian_dollar_futures_us_first30_last30_reversal_signalmonth_direction_opposite_entrym_77aa2b55` | 2.361094 | 61 | 1.287567 | 1.237570 |
| 34 | futures | ZT | `competition_us_treasury_2y_note_futures_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_ex_d2289e05` | 2.215788 | 62 | 1.316406 | 1.287599 |
| 35 | futures | 6B | `eur_usd_ny_sweep_logit_on_british_pound_futures` | 2.071429 | 57 | 1.111111 | 1.352941 |
| 36 | futures | NQ | `nasdaq_100_futures_round_hundred_rejection_15m` | 2.016510 | 53 | 1.333333 | 1.052947 |

The 100-strategy target is not reachable from the completed non-cheating backtests under these gates.
