# Cross-Market Futures RR Stress

- Source rows retested: 120
- Exit/stat execution timeframe: 1m
- RR brackets tested: 2, 2.5, 3, 4, 5
- Results: {'robust': 80, 'qualified_watch': 139, 'reject': 981}

## Top Results

| Status | Target | Base | RR | PF | Trades | Total R | Min Quarter PF | Bootstrap p05 | Block p05 | Annual Pass | Failed Checks |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| robust | NG | competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5 | 4 | 3.833804 | 54 | 11.153752 | 1.834484 | 1.864737 | 2.622330 | 1.000000 | none |
| robust | NG | competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5 | 3 | 3.581623 | 54 | 10.161176 | 1.834484 | 1.880105 | 2.652609 | 1.000000 | none |
| robust | NG | competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5 | 2.5 | 3.463938 | 54 | 9.697974 | 1.834484 | 1.782111 | 2.586999 | 1.000000 | none |
| robust | NG | competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5 | 5 | 3.228569 | 54 | 8.771571 | 1.834484 | 1.757597 | 2.424258 | 1.000000 | none |
| robust | MBT | competition_eur_cad_london_first30_last30_momentum_month_8_c5f12647 | 5 | 3.039940 | 34 | 16.553965 | 1.902604 | 1.360145 | 1.528403 | 1.000000 | none |
| robust | GC | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 3 | 2.923868 | 50 | 9.440500 | 2.022847 | 1.610545 | 1.795441 | 1.000000 | none |
| robust | GC | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 4 | 2.923868 | 50 | 9.440500 | 2.022847 | 1.622546 | 1.812594 | 1.000000 | none |
| robust | GC | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 5 | 2.923868 | 50 | 9.440500 | 2.022847 | 1.679120 | 1.882759 | 1.000000 | none |
| robust | GC | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 2.5 | 2.923868 | 50 | 9.440500 | 2.022847 | 1.617159 | 1.839193 | 1.000000 | none |
| robust | MBT | competition_eur_cad_london_first30_last30_momentum_month_8_c5f12647 | 4 | 2.904344 | 34 | 15.453611 | 1.820397 | 1.296558 | 1.460004 | 1.000000 | none |
| robust | ZT | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 3 | 2.722367 | 44 | 11.588717 | 1.168397 | 1.437728 | 1.380753 | 1.000000 | none |
| robust | ZT | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 2.5 | 2.656598 | 44 | 11.146194 | 1.168397 | 1.420431 | 1.387585 | 1.000000 | none |
| robust | MBT | competition_eur_cad_london_first30_last30_momentum_month_8_c5f12647 | 2.5 | 2.547391 | 34 | 12.556966 | 1.516458 | 1.211605 | 1.412423 | 1.000000 | none |
| robust | MBT | competition_eur_cad_london_first30_last30_momentum_month_8_c5f12647 | 3 | 2.534404 | 34 | 12.451576 | 1.542950 | 1.146392 | 1.296539 | 1.000000 | none |
| robust | 6C | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 3 | 2.348590 | 99 | 70.543363 | 1.138280 | 1.623189 | 1.724483 | 0.800000 | none |
| robust | ZT | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 4 | 2.327748 | 44 | 8.933575 | 1.168397 | 1.196158 | 1.328253 | 1.000000 | none |
| robust | ZT | competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e | 5 | 2.327748 | 44 | 8.933575 | 1.168397 | 1.200118 | 1.276891 | 1.000000 | none |
| robust | 6A | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 2.5 | 2.298367 | 98 | 55.927476 | 1.541733 | 1.621709 | 1.715972 | 0.800000 | none |
| robust | YM | competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f | 5 | 2.285772 | 108 | 50.029888 | 1.108419 | 1.523426 | 1.303865 | 0.800000 | none |
| robust | MET | competition_eur_chf_ny_open_gap_fade_month_9_5044d21c | 3 | 2.278757 | 36 | 22.426501 | 1.408007 | 1.258943 | 1.170179 | 1.000000 | none |
| robust | 6A | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 5 | 2.259492 | 98 | 56.696303 | 1.437507 | 1.530053 | 1.585101 | 0.800000 | none |
| robust | 6A | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 3 | 2.231192 | 98 | 53.221471 | 1.526230 | 1.529338 | 1.558310 | 0.800000 | none |
| robust | 6C | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 2.5 | 2.224312 | 99 | 61.585249 | 1.097867 | 1.635826 | 1.592352 | 0.800000 | none |
| robust | YM | competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f | 4 | 2.203788 | 108 | 46.839849 | 1.108419 | 1.484247 | 1.293365 | 0.800000 | none |
| robust | CL | competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f | 5 | 2.201861 | 106 | 54.196616 | 1.255075 | 1.426943 | 1.509606 | 1.000000 | none |
| robust | GC | competition_aud_nzd_daily_tsmom_next_overnight_weekday_side_4_long_0aa8225f | 5 | 2.191311 | 94 | 44.774811 | 1.762273 | 1.475184 | 1.384704 | 1.000000 | none |
| robust | 6A | competition_aud_usd_us_first30_last30_momentum_month_9_xasset_rr_5_629d8cc5 | 4 | 2.176619 | 52 | 9.511638 | 1.285758 | 1.030357 | 1.260934 | 1.000000 | none |
| robust | 6A | competition_aud_usd_london_first30_ny_open_momentum_weekday_side_0_short_xasset_rr_5_3aca24b7 | 4 | 2.174736 | 98 | 52.880966 | 1.357922 | 1.455318 | 1.538467 | 0.800000 | none |
| robust | HG | competition_aud_nzd_london_first30_last30_reversal_weekday_side_0_long_2e0ed4d2 | 3 | 2.149244 | 76 | 10.307125 | 1.266488 | 1.292453 | 1.231609 | 1.000000 | none |
| robust | HG | competition_aud_nzd_london_first30_last30_reversal_weekday_side_0_long_2e0ed4d2 | 4 | 2.149244 | 76 | 10.307125 | 1.266488 | 1.298931 | 1.217259 | 1.000000 | none |

## Gates

- `robust`: all trades refined on 1m execution data, PF above threshold, trade count, positive total R, planned RR > 2, chronological half/quarter PF > 1, rolling 20-trade lower-quartile PF > 1, bootstrap p05 > 1, block bootstrap p05 > 0.9, annual pass rate >= 60%.
- `qualified_watch`: PF/RR/trade-count gate passed, but at least one robustness check failed.
- `reject`: did not pass the PF/RR/trade-count gate.
