# Cross-Market Futures RR Stress

- Source rows retested: 25
- Exit/stat execution timeframe: 1m
- RR brackets tested: 3, 4, 5
- Results: {'robust': 12, 'qualified_watch': 32, 'reject': 106}

## Top Results

| Status | Target | Base | RR | PF | Trades | Total R | Min Quarter PF | Bootstrap p05 | Block p05 | Annual Pass | Failed Checks |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| robust | GC | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 3 | 2.923868 | 50 | 9.440500 | 2.022847 | 1.610545 | 1.795441 | 1.000000 | none |
| robust | GC | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 4 | 2.923868 | 50 | 9.440500 | 2.022847 | 1.622546 | 1.812594 | 1.000000 | none |
| robust | GC | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 5 | 2.923868 | 50 | 9.440500 | 2.022847 | 1.679120 | 1.882759 | 1.000000 | none |
| robust | 6C | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 3 | 2.508625 | 98 | 75.813067 | 1.407716 | 1.754357 | 1.846593 | 0.800000 | none |
| robust | 6A | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 5 | 2.371486 | 95 | 58.822147 | 1.640349 | 1.607742 | 1.628346 | 0.800000 | none |
| robust | 6A | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 3 | 2.346592 | 95 | 55.347314 | 1.740233 | 1.572155 | 1.702072 | 0.800000 | none |
| robust | 6C | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 5 | 2.332327 | 98 | 72.220340 | 1.360159 | 1.609057 | 1.810557 | 0.800000 | none |
| robust | 6A | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 4 | 2.282528 | 95 | 55.006809 | 1.553102 | 1.495810 | 1.597139 | 0.800000 | none |
| robust | 6C | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 4 | 2.274709 | 98 | 69.097045 | 1.166523 | 1.533466 | 1.743102 | 0.800000 | none |
| robust | GC | competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f | 5 | 2.203984 | 90 | 41.632252 | 1.779918 | 1.417398 | 1.385645 | 1.000000 | none |
| robust | GC | competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f | 4 | 2.080316 | 90 | 37.355970 | 1.652065 | 1.305445 | 1.345795 | 1.000000 | none |
| robust | ZT | competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f | 5 | 2.043816 | 127 | 64.689930 | 1.707614 | 1.459789 | 1.440598 | 1.000000 | none |
| qualified_watch | NG | competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5 | 4 | 3.619594 | 56 | 10.920819 | 1.955240 | 1.788973 | 2.424117 | 1.000000 | execution_tf_1m_all_trades |
| qualified_watch | NG | competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5 | 3 | 3.381503 | 56 | 9.928243 | 1.955240 | 1.719974 | 2.299261 | 1.000000 | execution_tf_1m_all_trades |
| qualified_watch | NG | competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5 | 5 | 3.048176 | 56 | 8.538637 | 1.955240 | 1.635626 | 2.226061 | 1.000000 | execution_tf_1m_all_trades |
| qualified_watch | 6B | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 4 | 2.782680 | 39 | 8.878714 | 0.945222 | 1.186667 | 1.208104 | 1.000000 | quarter_pf_gt_1 |
| qualified_watch | 6B | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 5 | 2.782680 | 39 | 8.878714 | 0.945222 | 1.183871 | 1.242375 | 1.000000 | quarter_pf_gt_1 |
| qualified_watch | ZT | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 3 | 2.741556 | 45 | 11.717824 | 1.242599 | 1.496876 | 1.504775 | 1.000000 | execution_tf_1m_all_trades |
| qualified_watch | 6B | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 3 | 2.573634 | 39 | 7.837549 | 0.945222 | 1.229782 | 1.260996 | 1.000000 | quarter_pf_gt_1 |
| qualified_watch | ZF | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 3 | 2.449551 | 48 | 8.948158 | 0.848645 | 1.331246 | 1.119123 | 0.750000 | quarter_pf_gt_1 |
| qualified_watch | ZF | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 4 | 2.449551 | 48 | 8.948158 | 0.848645 | 1.313682 | 1.035847 | 0.750000 | quarter_pf_gt_1 |
| qualified_watch | ZF | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 5 | 2.449551 | 48 | 8.948158 | 0.848645 | 1.331347 | 1.085735 | 0.750000 | quarter_pf_gt_1 |
| qualified_watch | 6N | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 4 | 2.365319 | 47 | 8.532723 | 0.940017 | 1.117995 | 0.937246 | 0.750000 | execution_tf_1m_all_trades,quarter_pf_gt_1,rolling20_pf_p25_gt_1 |
| qualified_watch | 6N | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 5 | 2.365319 | 47 | 8.532723 | 0.940017 | 1.310603 | 0.963696 | 0.750000 | execution_tf_1m_all_trades,quarter_pf_gt_1,rolling20_pf_p25_gt_1 |
| qualified_watch | ZT | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 4 | 2.346937 | 45 | 9.062682 | 1.242599 | 1.207490 | 1.369224 | 1.000000 | execution_tf_1m_all_trades |
| qualified_watch | ZT | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 5 | 2.346937 | 45 | 9.062682 | 1.242599 | 1.199698 | 1.332836 | 1.000000 | execution_tf_1m_all_trades |
| qualified_watch | MBT | competition_eur_cad_london_first30_last30_momentum_month_8_c5f12647 | 5 | 2.320580 | 58 | 20.769847 | 1.158723 | 1.326925 | 1.249033 | 1.000000 | execution_tf_1m_all_trades |
| qualified_watch | 6A | competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5 | 5 | 2.310101 | 53 | 10.590692 | 1.285758 | 1.059949 | 1.277044 | 1.000000 | execution_tf_1m_all_trades |
| qualified_watch | MET | competition_aud_nzd_london_first30_last30_reversal_weekday_side_0_long_2e0ed4d2 | 3 | 2.304813 | 37 | 14.670129 | 1.677951 | 1.208407 | 1.350141 | 1.000000 | execution_tf_1m_all_trades |
| qualified_watch | 6N | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 3 | 2.286069 | 47 | 8.037438 | 0.940017 | 1.168409 | 0.915524 | 0.750000 | execution_tf_1m_all_trades,quarter_pf_gt_1,rolling20_pf_p25_gt_1 |

## Gates

- `robust`: all trades refined on 1m execution data, PF above threshold, trade count, positive total R, planned RR > 2, chronological half/quarter PF > 1, rolling 20-trade lower-quartile PF > 1, bootstrap p05 > 1, block bootstrap p05 > 0.9, annual pass rate >= 60%.
- `qualified_watch`: PF/RR/trade-count gate passed, but at least one robustness check failed.
- `reject`: did not pass the PF/RR/trade-count gate.
