# True RR Replacement Search

- Evaluated fast candidate rows by asset: {'merged_previous': 4, 'copper_futures': 4}
- Qualified replacements applied: 5
- RR mix: {'5R': 4, '4R': 1}

| Strategy | Asset | PF | Trades | RR | Train PF | Variant |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `competition_aud_usd_ny_open_gap_fade_signalmonth_direction_fade_entryminute_570_exitbarminute_660_ming_5c432e4e` | aud_usd | 2.082 -> 3.647 | 65 -> 42 | 1.00 -> 4.32 | 1.369 | `competition_session_edge|family=us_first30_last30_reversal_signalmonth_month_10|direction=opposite|entry=930|exit=945|min_signal_atr=0.75|signal_end=585|signal_start=570|signal_month=10|risk_reward=5|managed_exit=bracket` |
| `competition_japanese_yen_futures_london_first30_ny_open_reversal_month_9_6d9e482f` | japanese_yen_futures | 2.117 -> 3.076 | 69 -> 31 | 1.00 -> 4.63 | 1.313 | `competition_session_edge|family=london_first30_ny_open_reversal_month_8|direction=opposite|entry=480|exit=570|min_signal_atr=1|signal_end=195|signal_start=180|signal_month=8|risk_reward=5|managed_exit=bracket` |
| `competition_dow_jones_futures_daily_tsmom_next_overnight_signalweekdayside_direction_momentum_entrymin_c2a8817b` | dow_jones_futures | 2.210 -> 2.356 | 132 -> 90 | 1.00 -> 3.96 | 0.929 | `competition_session_edge|family=daily_tsmom_next_overnight_signalweekdayside_weekday_side_1_long|direction=contrarian|entry=945|exit=570|lookback=20|signal_weekday_side=1_long|risk_reward=4|managed_exit=bracket` |
| `competition_us_treasury_30y_bond_futures_daily_tsmom_next_overnight_weekday_side_4_short_72a8080e` | us_treasury_30y_bond_futures | 2.240 -> 2.245 | 96 -> 90 | 1.00 -> 4.01 | 1.209 | `competition_session_edge|family=daily_tsmom_next_overnight_weekday_side_4_short|direction=contrarian|entry=945|exit=570|lookback=5|signal_weekday_side=4_short|risk_reward=5|managed_exit=bracket` |
| `competition_copper_futures_daily_tsmom_next_overnight_weekday_side_1_long_28c520df` | copper_futures | 2.014 -> 2.300 | 101 -> 101 | 1.00 -> 4.71 | 0.737 | `competition_session_edge|family=daily_tsmom_next_overnight_weekday_side_1_long|direction=contrarian|entry=945|exit=945|lookback=10|signal_weekday_side=1_long|risk_reward=5|managed_exit=bracket` |
